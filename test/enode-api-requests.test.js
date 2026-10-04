const EnodeAPI = require('../lib/enode-api');
const fetch = require('node-fetch'); // globally mocked in test/setup.js
const { clearTokenCache } = require('../lib/enode-machine-token');
const HomeyMock = require('homey');

function makeHomey() {
    const store = {};
    return {
        settings: {
            get: (k) => (k in store ? store[k] : null),
            set: (k, v) => { store[k] = v; },
        },
        cloud: { getHomeyId: jest.fn().mockResolvedValue('test-homey-id') },
        log: jest.fn(),
        error: jest.fn(),
    };
}

const okJson = (body) => ({ ok: true, status: 200, json: jest.fn().mockResolvedValue(body) });
const httpError = (status, headers = {}) => ({
    ok: false,
    status,
    headers: { get: (name) => headers[name.toLowerCase()] || null },
    text: jest.fn().mockResolvedValue(`error ${status}`),
});

describe('EnodeAPI request handling', () => {
    let api;

    beforeEach(() => {
        jest.resetAllMocks();
        jest.useRealTimers();
        clearTokenCache();
        HomeyMock.env = {};
        api = new EnodeAPI(makeHomey());
        api.clientManager.addClient('primary', 'Primary Client', 'cid', 'secret', true);
        api.retryBaseDelayMs = 1; // keep backoff fast in tests
    });

    afterEach(() => {
        api.destroy();
    });

    describe('makeRequest errors', () => {
        test('carry the HTTP status', async () => {
            fetch.mockResolvedValue(httpError(404));
            await expect(api.makeRequest('https://x/y', { method: 'GET' }))
                .rejects.toMatchObject({ status: 404 });
        });

        test('keep the readable message format', async () => {
            fetch.mockResolvedValue(httpError(401));
            await expect(api.makeRequest('https://x/y', { method: 'GET' }))
                .rejects.toThrow('HTTP error! status: 401');
        });
    });

    describe('retries', () => {
        test('never retry a POST, so a charge command cannot be sent twice', async () => {
            fetch.mockResolvedValue(httpError(503));
            await expect(api.makeRequest('https://x/charging', { method: 'POST' })).rejects.toThrow();
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        test('never retry a POST that failed with a network error', async () => {
            fetch.mockRejectedValue(new Error('socket hang up'));
            await expect(api.makeRequest('https://x/charging', { method: 'POST' })).rejects.toThrow();
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        test('do not retry a GET that failed with a client error', async () => {
            fetch.mockResolvedValue(httpError(404));
            await expect(api.makeRequest('https://x/y', { method: 'GET' })).rejects.toThrow();
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        test('retry a GET that failed with a server error', async () => {
            fetch
                .mockResolvedValueOnce(httpError(502))
                .mockResolvedValueOnce(okJson({ ok: 1 }));
            const res = await api.makeRequest('https://x/y', { method: 'GET' });
            expect(res.ok).toBe(true);
            expect(fetch).toHaveBeenCalledTimes(2);
        });

        test('retry a GET that failed with a network error', async () => {
            fetch
                .mockRejectedValueOnce(new Error('ECONNRESET'))
                .mockResolvedValueOnce(okJson({}));
            await api.makeRequest('https://x/y', { method: 'GET' });
            expect(fetch).toHaveBeenCalledTimes(2);
        });

        test('wait for Retry-After on a 429 before retrying', async () => {
            fetch
                .mockResolvedValueOnce(httpError(429, { 'retry-after': '0.05' }))
                .mockResolvedValueOnce(okJson({}));
            const started = Date.now();
            await api.makeRequest('https://x/y', { method: 'GET' });
            expect(Date.now() - started).toBeGreaterThanOrEqual(45);
            expect(fetch).toHaveBeenCalledTimes(2);
        });
    });

    describe('refresh-hint limits', () => {
        const vehicle = { id: 'v1', chargeState: {} };

        beforeEach(() => {
            fetch.mockImplementation(async (url) => {
                if (url.includes('/oauth2/token')) return okJson({ access_token: 't', expires_in: 3600 });
                if (url.endsWith('/refresh-hint')) return okJson({});
                return okJson(vehicle);
            });
        });

        const refreshHintCalls = () => fetch.mock.calls.filter(([url]) => url.endsWith('/refresh-hint')).length;

        test('allow only one refresh-hint per 5 minutes, even after the 60s request cache expires', async () => {
            let now = 1_800_000_000_000;
            jest.spyOn(Date, 'now').mockImplementation(() => now);

            await api.refreshVehicleData('v1', 0, 'primary');
            now += 2 * 60 * 1000; // 2 minutes later: past the old 60s cache TTL
            await api.refreshVehicleData('v1', 0, 'primary');

            expect(refreshHintCalls()).toBe(1);
            Date.now.mockRestore();
        });

        test('allow at most 9 refresh-hints per hour', async () => {
            let now = 1_800_000_000_000;
            jest.spyOn(Date, 'now').mockImplementation(() => now);

            for (let i = 0; i < 12; i++) {
                await api.refreshVehicleData('v1', 0, 'primary');
                now += 5 * 60 * 1000 + 1;
            }

            expect(refreshHintCalls()).toBeLessThanOrEqual(9);
            Date.now.mockRestore();
        });

        test('allow a refresh-hint again after 5 minutes', async () => {
            let now = 1_800_000_000_000;
            jest.spyOn(Date, 'now').mockImplementation(() => now);

            await api.refreshVehicleData('v1', 0, 'primary');
            now += 5 * 60 * 1000 + 1;
            await api.refreshVehicleData('v1', 0, 'primary');

            expect(refreshHintCalls()).toBe(2);
            Date.now.mockRestore();
        });
    });
});

describe('EnodeAPI.forHomey', () => {
    test('returns one shared client per Homey, so devices share rate limits and caches', () => {
        HomeyMock.env = {};
        const homey = makeHomey();
        const a = EnodeAPI.forHomey(homey);
        const b = EnodeAPI.forHomey(homey);
        expect(a).toBe(b);
        expect(EnodeAPI.forHomey(makeHomey())).not.toBe(a);
        a.destroy();
    });
});
