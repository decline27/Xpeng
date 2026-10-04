const fetch = require('node-fetch'); // globally mocked in test/setup.js
const HomeyMock = require('homey');
const EnodeAPI = require('../lib/enode-api');
const ClientManager = require('../lib/client-manager');
const { getMachineToken, clearTokenCache } = require('../lib/enode-machine-token');
const { RateLimiter, RequestCache } = require('../lib/utils');
const ErrorHandler = require('../lib/errorHandler');
const Logger = require('../lib/logger');

function makeHomey(initial = {}) {
    const store = { ...initial };
    return {
        settings: {
            get: (k) => (k in store ? store[k] : null),
            set: jest.fn((k, v) => { store[k] = v; }),
        },
        cloud: { getHomeyId: jest.fn().mockResolvedValue('homey-1') },
        log: jest.fn(),
        error: jest.fn(),
        _store: store,
    };
}

const okJson = (body) => ({ ok: true, status: 200, json: jest.fn().mockResolvedValue(body) });

beforeEach(() => {
    jest.resetAllMocks();
    clearTokenCache();
    HomeyMock.env = {};
});

describe('EnodeAPI.getVehicles', () => {
    let api;
    let homey;

    beforeEach(() => {
        homey = makeHomey();
        api = new EnodeAPI(homey);
        api.clientManager.addClient('primary', 'Primary', 'cid1', 'sec1', true);
        api.clientManager.addClient('secondary', 'Secondary', 'cid2', 'sec2', true);
        api.getAccessToken = jest.fn().mockResolvedValue('token');
    });

    afterEach(() => api.destroy());

    const respondWith = (byClient) => {
        api._getVehiclesForClient = jest.fn(async (clientId) => (byClient[clientId] || [])
            .map((v) => ({ ...v, _clientId: clientId, _accountId: clientId })));
    };

    test('keeps this user\'s copy of a car even when another user\'s copy was seen more recently', async () => {
        respondWith({
            primary: [{ id: 'mine', userId: 'homey-homey-1', lastSeen: '2026-10-01T00:00:00Z', information: { vin: 'VIN1' } }],
            secondary: [{ id: 'theirs', userId: 'other', lastSeen: '2026-10-04T00:00:00Z', information: { vin: 'VIN1' } }],
        });

        const vehicles = await api.getVehicles();

        expect(vehicles.map((v) => v.id)).toEqual(['mine']);
    });

    test('only maps this user\'s vehicles to clients, not the whole fleet', async () => {
        respondWith({
            primary: [{ id: 'mine', userId: 'homey-homey-1', information: { vin: 'VIN1' } }],
            secondary: [{ id: 'theirs', userId: 'other', information: { vin: 'VIN2' } }],
        });
        const spy = jest.spyOn(api.clientManager, 'setVehicleClient');

        await api.getVehicles();

        const mapped = spy.mock.calls.map(([id]) => id);
        expect(mapped).toEqual(expect.arrayContaining(['mine', 'VIN1']));
        expect(mapped).not.toContain('theirs');
        expect(mapped).not.toContain('VIN2');
    });
});

describe('ClientManager.setVehicleClient', () => {
    test('does not rewrite settings when the mapping is unchanged', () => {
        const homey = makeHomey();
        const manager = new ClientManager(homey);
        manager.addClient('primary', 'Primary', 'cid', 'sec', true);
        manager.setVehicleClient('v1', 'primary');
        homey.settings.set.mockClear();

        manager.setVehicleClient('v1', 'primary');

        expect(homey.settings.set).not.toHaveBeenCalled();
    });
});

describe('client secrets', () => {
    test('are not written to the persistent settings', () => {
        const homey = makeHomey();
        const manager = new ClientManager(homey);
        manager.addClient('primary', 'Primary', 'cid', 'super-secret', true);

        expect(JSON.stringify(homey._store)).not.toContain('super-secret');
    });

    test('are still available for requests in the running app', () => {
        const manager = new ClientManager(makeHomey());
        manager.addClient('primary', 'Primary', 'cid', 'super-secret', true);

        expect(manager.getClientCredentials('primary').clientSecret).toBe('super-secret');
        expect(manager.getAllClients()[0].enodeClientSecret).toBe('super-secret');
    });

    test('secrets stored by older versions are removed from settings but keep working this run', () => {
        const homey = makeHomey({
            enode_client_registry: { clients: [{ id: 'legacy_client', name: 'L', enodeClientId: 'cid', enodeClientSecret: 'old-secret' }] },
            default_client: 'legacy_client',
        });

        const manager = new ClientManager(homey);

        expect(JSON.stringify(homey._store)).not.toContain('old-secret');
        expect(manager.getClientCredentials('legacy_client').clientSecret).toBe('old-secret');
    });
});

describe('vehicle list pagination', () => {
    test('follows Enode pagination to fetch every page', async () => {
        const homey = makeHomey();
        const api = new EnodeAPI(homey);
        api.clientManager.addClient('primary', 'Primary', 'cid', 'sec', true);
        api.getAccessToken = jest.fn().mockResolvedValue('token');
        fetch
            .mockResolvedValueOnce(okJson({ data: [{ id: 'a' }], pagination: { after: 'cursor-1' } }))
            .mockResolvedValueOnce(okJson({ data: [{ id: 'b' }], pagination: { after: null } }));

        const vehicles = await api._getVehiclesForClient('primary');

        expect(vehicles.map((v) => v.id)).toEqual(['a', 'b']);
        expect(fetch.mock.calls[1][0]).toContain('after=cursor-1');
        api.destroy();
    });
});

describe('machine token', () => {
    test('concurrent requests share one token fetch', async () => {
        let resolveFetch;
        fetch.mockImplementation(() => new Promise((resolve) => { resolveFetch = resolve; }));

        const first = getMachineToken({ clientId: 'c', clientSecret: 's' }, 'acct');
        const second = getMachineToken({ clientId: 'c', clientSecret: 's' }, 'acct');
        resolveFetch(okJson({ access_token: 'tok', expires_in: 3600 }));

        await expect(Promise.all([first, second])).resolves.toEqual(['tok', 'tok']);
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    test('the token request has a timeout', async () => {
        fetch.mockResolvedValue(okJson({ access_token: 'tok', expires_in: 3600 }));
        await getMachineToken({ clientId: 'c', clientSecret: 's' }, 'acct2');
        expect(fetch.mock.calls[0][1].signal).toBeDefined();
    });

    test('a 401 from the API clears cached tokens so the next request gets a fresh one', async () => {
        const api = new EnodeAPI(makeHomey());
        api.retryBaseDelayMs = 1;
        fetch.mockResolvedValueOnce(okJson({ access_token: 'old', expires_in: 3600 }));
        await getMachineToken({ clientId: 'c', clientSecret: 's' }, 'acct3');

        fetch.mockResolvedValueOnce({ ok: false, status: 401, headers: { get: () => null }, text: async () => 'expired' });
        await expect(api.makeRequest('https://x/vehicles', { method: 'GET' })).rejects.toMatchObject({ status: 401 });

        fetch.mockResolvedValueOnce(okJson({ access_token: 'new', expires_in: 3600 }));
        await expect(getMachineToken({ clientId: 'c', clientSecret: 's' }, 'acct3')).resolves.toBe('new');
        api.destroy();
    });
});

describe('RateLimiter', () => {
    test('concurrent callers cannot exceed the limit, even when several are waiting', async () => {
        const limiter = new RateLimiter(2, 100);
        const started = Date.now();
        const times = await Promise.all([1, 2, 3, 4, 5, 6].map(async () => {
            await limiter.throttle();
            return Date.now() - started;
        }));
        times.sort((a, b) => a - b);
        // No more than 2 calls may start within any 100 ms window
        for (let i = 2; i < times.length; i++) {
            expect(times[i] - times[i - 2]).toBeGreaterThanOrEqual(90);
        }
    });
});

describe('RequestCache', () => {
    test('when full, evicts expired and oldest entries instead of wiping everything', () => {
        const cache = new RequestCache(5, 60000);
        for (let i = 0; i < 5; i++) cache.set(`k${i}`, i);

        cache.set('k5', 5);

        expect(cache.get('k5')).toBe(5);
        expect(cache.get('k4')).toBe(4);
        expect(cache.getStats().size).toBeLessThanOrEqual(5);
        cache.destroy();
    });
});

describe('ErrorHandler', () => {
    test('a 401 is an authentication problem even when the message mentions fetch', () => {
        const error = Object.assign(new Error('Failed to fetch vehicles: HTTP error! status: 401'), { status: 401 });
        expect(ErrorHandler.translateError(error).type).toBe(ErrorHandler.ErrorTypes.AUTHENTICATION);
    });

    test('a status in the message text is recognised when the error has no status property', () => {
        const error = new Error('Failed to get vehicle data: HTTP error! status: 401, url: x');
        expect(ErrorHandler.translateError(error).type).toBe(ErrorHandler.ErrorTypes.AUTHENTICATION);
    });

    test('"successfully" is not mistaken for a full battery', () => {
        const error = new Error('Command sent successfully but refresh failed');
        expect(ErrorHandler.translateError(error).message).not.toMatch(/100%/);
    });

    test('a full battery is still recognised', () => {
        const error = new Error('Battery is already full (at the 80% charge limit)');
        expect(ErrorHandler.translateError(error).type).toBe(ErrorHandler.ErrorTypes.VEHICLE_STATE);
    });
});

describe('Logger', () => {
    test('keeps the message of Error objects in logged data', () => {
        expect(Logger.formatMessage('Failed:', new Error('boom'))).toContain('boom');
        expect(Logger.formatMessage('Failed:', { error: new Error('nested boom') })).toContain('nested boom');
    });
});

describe('Enode outage at startup', () => {
    test('getVehicles throws when every client is unreachable, instead of returning no cars', async () => {
        const api = new EnodeAPI(makeHomey());
        api.clientManager.addClient('primary', 'Primary', 'cid', 'sec', true);
        api.getAccessToken = jest.fn().mockResolvedValue('token');
        api.retryBaseDelayMs = 1;
        fetch.mockRejectedValue(new Error('ECONNRESET'));

        await expect(api.getVehicles()).rejects.toThrow(/ECONNRESET|unreachable/);
        api.destroy();
    });
});
