const EnodeAPI = require('../lib/enode-api');
const { clearTokenCache } = require('../lib/enode-machine-token');
const HomeyMock = require('homey');
const ErrorHandler = require('../lib/errorHandler');

function makeHomey() {
    const store = {};
    return {
        settings: { get: (k) => (k in store ? store[k] : null), set: (k, v) => { store[k] = v; } },
        cloud: { getHomeyId: jest.fn().mockResolvedValue('test-homey-id') },
        log: jest.fn(),
        error: jest.fn(),
    };
}

describe('EnodeAPI charging rules', () => {
    let api;

    beforeEach(() => {
        jest.resetAllMocks();
        clearTokenCache();
        HomeyMock.env = {};
        api = new EnodeAPI(makeHomey());
        api.clientManager.addClient('primary', 'Primary Client', 'cid', 'secret', true);
        api.getVehicles = jest.fn().mockResolvedValue([{ id: 'v1', _clientId: 'primary' }]);
        api.getAccessToken = jest.fn().mockResolvedValue('token');
        api.makeRequest = jest.fn().mockResolvedValue({ json: async () => ({ id: 'action-1' }) });
        api.waitForAction = jest.fn().mockResolvedValue({ state: 'CONFIRMED' });
    });

    afterEach(() => api.destroy());

    const withState = (chargeState) => {
        api.getVehicleData = jest.fn().mockResolvedValue({ id: 'v1', chargeState });
    };

    test('STOP on an unplugged car succeeds without sending a command', async () => {
        withState({ isPluggedIn: false, isCharging: false });

        await expect(api.stopCharging('v1')).resolves.toMatchObject({ state: 'CONFIRMED' });
        expect(api.makeRequest).not.toHaveBeenCalled();
    });

    test('START on an unplugged car is still refused', async () => {
        withState({ isPluggedIn: false, isCharging: false });
        await expect(api.startCharging('v1')).rejects.toThrow('not plugged in');
    });

    test('START is refused when the battery is at the charge limit', async () => {
        withState({ isPluggedIn: true, isCharging: false, batteryLevel: 80, chargeLimit: 80 });
        await expect(api.startCharging('v1')).rejects.toThrow('charge limit');
    });

    test('START is refused when Enode says the battery is fully charged', async () => {
        withState({ isPluggedIn: true, isCharging: false, batteryLevel: 79, chargeLimit: 80, isFullyCharged: true });
        await expect(api.startCharging('v1')).rejects.toThrow('charge limit');
    });

    test('START is sent when below the charge limit', async () => {
        withState({ isPluggedIn: true, isCharging: false, batteryLevel: 60, chargeLimit: 80 });
        await api.startCharging('v1');
        expect(api.makeRequest).toHaveBeenCalledWith(
            expect.stringContaining('/vehicles/v1/charging'),
            expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'START' }) }),
        );
    });

    test('waitForAction polls the action on the vehicle\'s client', async () => {
        withState({ isPluggedIn: true, isCharging: true });
        await api.stopCharging('v1');
        expect(api.waitForAction).toHaveBeenCalledWith('action-1', undefined, undefined, 'primary', 'v1');
    });
});

describe('EnodeAPI.waitForAction', () => {
    let api;

    beforeEach(() => {
        HomeyMock.env = {};
        api = new EnodeAPI(makeHomey());
    });

    afterEach(() => api.destroy());

    test('reports the readable failure reason from Enode v3', async () => {
        api.getActionStatus = jest.fn().mockResolvedValue({
            state: 'FAILED',
            failureReason: { type: 'NO_RESPONSE', detail: 'The vehicle did not respond' },
        });
        await expect(api.waitForAction('a1', 1, 1)).rejects.toThrow('The vehicle did not respond');
    });

    test('a timeout is classified as a network/timeout problem, not a generic error', async () => {
        api.getActionStatus = jest.fn().mockResolvedValue({ state: 'PENDING' });
        const error = await api.waitForAction('a1', 1, 2).catch((e) => e);
        expect(error.message).toMatch(/timeout/i);
        expect(ErrorHandler.translateError(error).type).toBe(ErrorHandler.ErrorTypes.NETWORK);
    });

    test('waits up to 2 minutes by default because cars can take a while to wake', async () => {
        const realSetTimeout = global.setTimeout;
        global.setTimeout = (fn) => realSetTimeout(fn, 0);
        try {
            api.getActionStatus = jest.fn().mockResolvedValue({ state: 'PENDING' });
            const error = await api.waitForAction('a1').catch((e) => e);
            expect(error.message).toMatch(/120 seconds/);
            expect(api.getActionStatus).toHaveBeenCalledTimes(60);
        } finally {
            global.setTimeout = realSetTimeout;
        }
    });

    test('polls the action with the vehicle id so the right client is used', async () => {
        api.getActionStatus = jest.fn().mockResolvedValue({ state: 'CONFIRMED' });
        await api.waitForAction('a1', 1, 1, 'primary', 'v1');
        expect(api.getActionStatus).toHaveBeenCalledWith('a1', 'v1', 'primary');
    });
});
