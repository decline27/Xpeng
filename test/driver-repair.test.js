jest.mock('../lib/user-identity', () => ({
    resolveUserId: jest.fn().mockResolvedValue('homey_stable'),
    getUserIdCandidates: jest.fn().mockResolvedValue(['homey_stable', 'homey_legacy']),
}));

const XpengDriver = require('../drivers/cars/driver');

function makeDriver(vehicles) {
    const driver = Object.create(XpengDriver.prototype);
    Object.defineProperty(driver, 'homey', {
        value: { settings: { get: jest.fn(), set: jest.fn() } },
    });
    driver.log = jest.fn();
    driver.error = jest.fn();
    driver.enodeApi = {
        getVehicles: jest.fn().mockResolvedValue(vehicles),
        generateVehicleLink: jest.fn().mockResolvedValue('https://link.enode.io/abc'),
        requestCache: { clear: jest.fn() },
    };
    return driver;
}

function makeSession() {
    const handlers = {};
    return { handlers, setHandler: jest.fn((name, fn) => { handlers[name] = fn; }) };
}

function makeDevice() {
    return {
        getName: () => 'XPENG G6',
        getData: () => ({ id: 'old-id', vin: 'VIN123' }),
        vehicleId: 'old-id',
        getStoreValue: jest.fn(),
        setVehicleId: jest.fn().mockResolvedValue(),
        refreshData: jest.fn().mockResolvedValue(true),
        setAvailable: jest.fn().mockResolvedValue(),
    };
}

describe('driver repair', () => {
    const relinked = { id: 'new-id', _clientId: 'secondary', userId: 'homey_stable', information: { vin: 'VIN123' } };
    const stillOld = { id: 'old-id', _clientId: 'primary', userId: 'homey_stable', lastSeen: '2020-01-01T00:00:00Z', information: { vin: 'VIN123' } };

    test('offers a fresh Enode link for the user', async () => {
        const driver = makeDriver([relinked]);
        const session = makeSession();
        await driver.onRepair(session, makeDevice());

        await expect(session.handlers.get_link()).resolves.toEqual({ linkUrl: 'https://link.enode.io/abc' });
        expect(driver.enodeApi.generateVehicleLink).toHaveBeenCalledWith('homey_stable');
    });

    test('reports authenticated once the user\'s car is linked again', async () => {
        const driver = makeDriver([relinked]);
        const session = makeSession();
        await driver.onRepair(session, makeDevice());

        await expect(session.handlers.check_auth_status()).resolves.toMatchObject({ isAuthenticated: true });
    });

    test('repair_complete moves the device to the re-linked vehicle id (matched by VIN) and refreshes', async () => {
        const driver = makeDriver([relinked]);
        const session = makeSession();
        const device = makeDevice();
        await driver.onRepair(session, device);

        await expect(session.handlers.repair_complete()).resolves.toEqual({ success: true, vehicleId: 'new-id' });
        expect(device.setVehicleId).toHaveBeenCalledWith('new-id', 'secondary');
        expect(device.refreshData).toHaveBeenCalled();
    });

    test('repair_complete explains when the car is not linked yet', async () => {
        const driver = makeDriver([]);
        const session = makeSession();
        const device = makeDevice();
        await driver.onRepair(session, device);

        await expect(session.handlers.repair_complete()).rejects.toThrow(/not found/i);
        expect(device.setVehicleId).not.toHaveBeenCalled();
    });

    test('does not report connected while only the old link exists', async () => {
        const driver = makeDriver([stillOld]);
        const session = makeSession();
        await driver.onRepair(session, makeDevice());
        await session.handlers.get_link();

        await expect(session.handlers.check_auth_status()).resolves.toMatchObject({ isAuthenticated: false });
    });

    test('repair_complete fails when the device still cannot fetch data', async () => {
        const driver = makeDriver([relinked]);
        const session = makeSession();
        const device = makeDevice();
        device.refreshData.mockResolvedValue(false);
        await driver.onRepair(session, device);

        await expect(session.handlers.repair_complete()).rejects.toThrow(/could not/i);
        expect(device.setAvailable).not.toHaveBeenCalled();
    });

    test('repair_complete ignores another user\'s copy of the same car', async () => {
        const driver = makeDriver([{ id: 'someone-else', userId: 'other_user', information: { vin: 'VIN123' } }]);
        const session = makeSession();
        await driver.onRepair(session, makeDevice());

        await expect(session.handlers.repair_complete()).rejects.toThrow(/not found/i);
    });
});
