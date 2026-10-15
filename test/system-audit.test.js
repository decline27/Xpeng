const Homey = require('homey');
const fetch = require('node-fetch');
const ClientManager = require('../lib/client-manager');
const AccountManager = require('../lib/account-manager');
const EnodeAPI = require('../lib/enode-api');
const ErrorHandler = require('../lib/errorHandler');
const { getMachineToken, clearTokenCache } = require('../lib/enode-machine-token');
const { makeDevice } = require('./helpers/device-harness');
const widget = require('../widgets/xpeng/api');

function makeHomey(initial = {}) {
    const store = { ...initial };
    return {
        settings: { get: key => store[key], set: (key, value) => { store[key] = value; } },
        cloud: { getHomeyId: async () => 'owner' },
        log: jest.fn(), error: jest.fn(), store,
    };
}
const ok = data => ({ ok: true, json: async () => data });
const failure = (status, message) => ({ ok: false, status, text: async () => message });

beforeEach(() => {
    Homey.env = {};
    fetch.mockReset();
    clearTokenCache();
});

describe('production account registration', () => {
    test('loads new credentials even when a default was saved by an earlier version', () => {
        Homey.env = { ENODE_CLIENT_ID_6: 'extra-client', ENODE_CLIENT_SECRET_6: 'extra-secret' };
        const homey = makeHomey({ default_client: 'primary' });
        const manager = new ClientManager(homey);
        expect(manager.getClientCredentials('client_6')).toMatchObject({ clientId: 'extra-client', clientSecret: 'extra-secret' });
        expect(manager.getDefaultClient()).toBe('client_6');
        expect(JSON.stringify(homey.store)).not.toContain('extra-secret');
    });

    test('accepts numbered accounts with gaps and beyond ten', () => {
        Homey.env = {
            ENODE_CLIENT_ID_11: 'eleven', ENODE_CLIENT_SECRET_11: 'eleven-secret',
            ENODE_CLIENT_ID_3: '', ENODE_CLIENT_SECRET_3: '',
            ENODE_CLIENT_ID_7: 'seven', ENODE_CLIENT_SECRET_7: 'seven-secret',
        };
        const manager = new ClientManager(makeHomey());
        expect(manager.getAllClients().map(c => c.id)).toEqual(['client_7', 'client_11']);
        expect(manager.getDefaultClient()).toBe('client_7');
    });

    test('does not infer shared capacity from this Homey\'s VIN and vehicle-id mappings', () => {
        const manager = new ClientManager(makeHomey());
        manager.addClient('primary', 'Primary', 'p', 'ps');
        manager.addClient('secondary', 'Secondary', 's', 'ss');
        for (let i = 0; i < 30; i++) manager.setVehicleClient(`old-id-${i}`, 'primary');
        expect(manager.getClientForNewVehicle()).toBe('primary');
    });

    test('keeps secrets isolated between Homey instances', () => {
        const first = new ClientManager(makeHomey());
        const second = new ClientManager(makeHomey());
        first.addClient('primary', 'Primary', 'first', 'first-secret');
        second.addClient('primary', 'Primary', 'second', 'second-secret');
        expect(first.getClientCredentials('primary').clientSecret).toBe('first-secret');
    });

    test('legacy account wrapper accepts an additional registered client', () => {
        const manager = new AccountManager(makeHomey());
        manager.clientManager.addClient('client_6', 'Extra', 'extra', 'secret');
        manager.setVehicleAccount('VIN6', 'client_6');
        manager.setDefaultAccount('client_6');
        expect(manager.getVehicleCredentials('VIN6')).toMatchObject({ accountId: 'client_6', clientId: 'extra' });
    });
});

describe('API discovery and pairing', () => {
    let api;
    let homey;
    beforeEach(() => {
        homey = makeHomey({ authorized_vins: ['KNOWN'] });
        api = new EnodeAPI(homey);
        api.clientManager.addClient('primary', 'Primary', 'p', 'ps');
        api.clientManager.addClient('client_6', 'Extra', 'e', 'es');
        api.getAccessToken = jest.fn().mockResolvedValue('token');
        api.retryBaseDelayMs = 1;
    });
    afterEach(() => api.destroy());

    test('discovers a second owned car while keeping previously authorized vehicles', async () => {
        const result = await api._filterVehicles([
            { id: 'existing', userId: 'homey-owner', information: { vin: 'KNOWN' } },
            { id: 'second', userId: 'homey-owner', information: { vin: 'NEW' } },
            { id: 'foreign-copy', userId: 'someone-else', information: { vin: 'KNOWN' } },
            { id: 'foreign', userId: 'someone-else', information: { vin: 'OTHER' } },
        ]);
        expect(result.map(v => v.id)).toEqual(['existing', 'second']);
        expect(homey.store.authorized_vins).toEqual(['KNOWN', 'NEW']);
    });

    test('ignores empty users left by abandoned connection attempts', async () => {
        fetch.mockResolvedValueOnce(ok({ linkedVendors: [] }))
            .mockResolvedValueOnce(ok({ linkedVendors: [{ vendor: 'XPENG' }] }));
        await expect(api.findClientForUser('returning')).resolves.toBe('client_6');
        expect(fetch.mock.calls.every(([, options]) => options.signal)).toBe(true);
    });

    test('does not create a new link when user lookup cannot prove the user is absent', async () => {
        fetch.mockResolvedValue(failure(503, 'Unavailable'));
        await expect(api.generateVehicleLink('returning')).rejects.toThrow('503');
        expect(fetch.mock.calls.some(([, options]) => options.method === 'POST')).toBe(false);
    });

    test('new users try the additional account after a capacity rejection', async () => {
        api.findClientForUser = jest.fn().mockResolvedValue(null);
        fetch.mockResolvedValueOnce(failure(403, 'Connections limit reached'))
            .mockResolvedValueOnce(ok({ linkUrl: 'https://link.enode.io/extra' }));
        await expect(api.generateVehicleLink('new')).resolves.toBe('https://link.enode.io/extra');
        expect(api.getAccessToken.mock.calls).toEqual([[null, 'primary'], [null, 'client_6']]);
    });

    test('an explicitly selected repair account never rotates into another account', async () => {
        fetch.mockResolvedValue(failure(403, 'Connections limit reached'));
        await expect(api.generateVehicleLink('existing', 'client_6')).rejects.toThrow('Connections limit reached');
        expect(api.getAccessToken).toHaveBeenCalledTimes(1);
        expect(api.getAccessToken).toHaveBeenCalledWith(null, 'client_6');
    });

    test('propagates authentication failures instead of reporting an empty garage', async () => {
        fetch.mockResolvedValue(failure(401, 'Unauthorized'));
        await expect(api.getVehicles()).rejects.toThrow('401');
    });

    test('single-vehicle reads retain the hosting account', async () => {
        fetch.mockResolvedValue(ok({ id: 'vehicle', information: { vin: 'VIN6' } }));
        await expect(api.getVehicleData('vehicle', 'client_6')).resolves.toMatchObject({ _clientId: 'client_6', _accountId: 'client_6' });
    });

    test('a rate-limited wake request still reads uncached vehicle data', async () => {
        api.requestCache.set('vehicle_vehicle', { id: 'vehicle', chargeState: { batteryLevel: 20 } });
        api.refreshState.set('vehicle', { last: Date.now(), count: 1, windowStart: Date.now() });
        fetch.mockResolvedValue(ok({ id: 'vehicle', chargeState: { batteryLevel: 80 } }));
        const data = await api.refreshVehicleData('vehicle', 0, 'client_6');
        expect(data.chargeState.batteryLevel).toBe(80);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fetch.mock.calls[0][0]).not.toContain('refresh-hint');
    });
});

describe('device data freshness and account routing', () => {
    test('a successful poll of old data does not prevent later refresh attempts', async () => {
        const stale = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const { device, store } = makeDevice({
            capabilities: { chargingStatus: 'Not Connected' },
            store: { lastDataUpdate: Date.now() },
            vehicle: { id: 'vehicle-123', lastSeen: stale, chargeState: { isCharging: false } },
        });
        await device.pollVehicleData();
        expect(store.lastVehicleUpdate).toBe(Date.parse(stale));
        await device.pollVehicleData();
        expect(device.enodeApi.refreshVehicleData).toHaveBeenCalledTimes(1);
    });

    test('old charge data counts as stale even when location and lastSeen are current', async () => {
        const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
        const { device, store } = makeDevice({ vehicle: { id: 'vehicle-123', lastSeen: new Date().toISOString(), chargeState: { lastUpdated: old } } });
        await device.pollVehicleData();
        expect(store.lastVehicleUpdate).toBe(Date.parse(old));
    });

    test('manual refresh attempts fresh data even when the previous poll succeeded recently', async () => {
        const { device } = makeDevice({ store: { lastDataUpdate: Date.now() }, capabilities: { chargingStatus: 'Not Connected' } });
        await expect(device.refreshData()).resolves.toBe(true);
        expect(device.enodeApi.refreshVehicleData).toHaveBeenCalled();
    });

    test('does not repeatedly send unsupported wake commands', async () => {
        const { device } = makeDevice({
            vehicle: { id: 'vehicle-123', capabilities: { refreshState: { isCapable: false } } },
        });
        await device.pollVehicleData();
        device.enodeApi.refreshVehicleData.mockClear();
        await device.refreshData();
        expect(device.enodeApi.refreshVehicleData).not.toHaveBeenCalled();
        expect(device.enodeApi.getVehicleData).toHaveBeenCalled();
    });

    test('startup repairs a missing or incorrect account for the existing vehicle id', async () => {
        const { device, store } = makeDevice({
            store: { accountId: 'primary' },
            vehicle: { id: 'vehicle-123', _clientId: 'client_6' },
        });
        await device.verifyVehicle();
        expect(store.accountId).toBe('client_6');
    });
});

describe('credential rotation', () => {
    test('does not reuse tokens after a secret or account is replaced', async () => {
        fetch.mockResolvedValueOnce(ok({ access_token: 'old', expires_in: 3600 }))
            .mockResolvedValueOnce(ok({ access_token: 'new', expires_in: 3600 }));
        await getMachineToken({ clientId: 'client', clientSecret: 'old-secret' }, 'client_6');
        await expect(getMachineToken({ clientId: 'client', clientSecret: 'new-secret' }, 'client_6')).resolves.toBe('new');
    });
});

describe('user-visible errors and widget controls', () => {
    test.each(['Connections limit reached', 'connection_limit_reached'])(
        'explains capacity before interpreting HTTP 403 as a permission problem: %s', message => {
            const handled = ErrorHandler.translateError(Object.assign(new Error(message), { status: 403 }));
            expect(handled.type).toBe('capacity');
            expect(handled.suggestion).toContain('Reinstalling');
        }
    );

    test('a deleted widget selection cannot control another car', async () => {
        const car = { getId: () => 'other-car', startCharging: jest.fn(), stopCharging: jest.fn() };
        const homey = { drivers: { getDriver: () => ({ getDevices: () => [car] }) } };
        const result = await widget.startCharging({ homey, body: { deviceId: 'deleted-car' } });
        expect(result.error).toBeDefined();
        expect(car.startCharging).not.toHaveBeenCalled();
    });
});

test('vehicle pagination cannot silently return an incomplete cleanup inventory', async () => {
    const api = new EnodeAPI(makeHomey());
    api.getAccessToken = jest.fn().mockResolvedValue('token');
    fetch.mockResolvedValue(ok({ data: [{ id: 'v' }], pagination: { after: 'repeated' } }));
    await expect(api._getVehiclesForClient('primary')).rejects.toThrow('pagination repeated');
    expect(api.requestCache.get('vehicles_primary')).toBeNull();
    api.destroy();
});

test('legacy account fallback also reports an outage rather than an empty garage', async () => {
    const api = new EnodeAPI(makeHomey());
    api.accountManager.checkAccountsStatus = () => ({ primaryConfigured: true, secondaryConfigured: true });
    api._getVehiclesForClient = jest.fn().mockRejectedValue(new Error('HTTP error! status: 503'));
    await expect(api._getVehiclesUsingAccountManager()).rejects.toThrow('503');
    api.destroy();
});

test('missing production credentials are reported as configuration trouble', async () => {
    const api = new EnodeAPI(makeHomey());
    let failure;
    try { await api.getVehicles(); } catch (error) { failure = error; }
    expect(failure).toBeDefined();
    expect(ErrorHandler.translateError(failure).type).toBe('configuration');
    api.destroy();
});
