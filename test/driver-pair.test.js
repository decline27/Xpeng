jest.mock('../lib/user-identity', () => ({
    resolveUserId: jest.fn().mockResolvedValue('homey_stable'),
    getUserIdCandidates: jest.fn().mockResolvedValue(['homey_stable']),
}));

const XpengDriver = require('../drivers/cars/driver');

function makeDriver(vehicles) {
    const store = {};
    const driver = Object.create(XpengDriver.prototype);
    Object.defineProperty(driver, 'homey', {
        value: { settings: { get: (k) => store[k], set: (k, v) => { store[k] = v; } } },
    });
    driver.log = jest.fn();
    driver.error = jest.fn();
    driver.enodeApi = {
        getVehicles: jest.fn().mockResolvedValue(vehicles),
        requestCache: { clear: jest.fn() },
        clearVehicleListCache: jest.fn(),
    };
    return driver;
}

async function pair(driver) {
    const handlers = {};
    await driver.onPair({ setHandler: (name, fn) => { handlers[name] = fn; } });
    return handlers;
}

describe('driver pairing', () => {
    const car = {
        id: 'enode-1',
        userId: 'homey_stable',
        lastSeen: '2026-10-04T19:27:00Z',
        information: { vin: 'L1NAAAA6RB059538', model: 'G6' },
    };

    test('uses the VIN as the device id so a re-linked car is not offered as a new device', async () => {
        const handlers = await pair(makeDriver([car]));
        const [device] = await handlers.list_devices();
        expect(device.data).toEqual({ id: 'L1NAAAA6RB059538', vehicleId: 'enode-1', vin: 'L1NAAAA6RB059538' });
    });

    test('lets the driver manifest define the capabilities', async () => {
        const handlers = await pair(makeDriver([car]));
        const [device] = await handlers.list_devices();
        expect(device.capabilities).toBeUndefined();
    });

    test('does not store unused OAuth token data', async () => {
        const handlers = await pair(makeDriver([car]));
        const [device] = await handlers.list_devices();
        expect(device.store).toEqual({ vehicleId: 'enode-1' });
    });

    test('does not register the credential-saving handler the pairing page never calls', async () => {
        const handlers = await pair(makeDriver([car]));
        expect(handlers.save_credentials).toBeUndefined();
    });

    test('does not report a finished link while only the cars from before the link exist', async () => {
        const driver = makeDriver([car]);
        driver.enodeApi.generateVehicleLink = jest.fn().mockResolvedValue('https://link.enode.io/abc');
        const handlers = await pair(driver);
        await handlers.get_link();
        await expect(handlers.check_auth_status())
            .resolves.toMatchObject({ isAuthenticated: false, hasExistingVehicles: true });

        const second = { ...car, id: 'enode-2', information: { vin: 'SECONDVIN', model: 'G9' } };
        driver.enodeApi.getVehicles.mockResolvedValue([car, second]);
        await expect(handlers.check_auth_status()).resolves.toMatchObject({ isAuthenticated: true });
    });

    test('reports a finished link for a first car', async () => {
        const driver = makeDriver([]);
        driver.enodeApi.generateVehicleLink = jest.fn().mockResolvedValue('https://link.enode.io/abc');
        const handlers = await pair(driver);
        await handlers.get_link();
        driver.enodeApi.getVehicles.mockResolvedValue([car]);
        await expect(handlers.check_auth_status())
            .resolves.toMatchObject({ isAuthenticated: true, hasExistingVehicles: false });
    });

    test('only lists the user\'s own cars', async () => {
        const handlers = await pair(makeDriver([car, { ...car, id: 'enode-2', userId: 'someone_else', information: { vin: 'OTHER' } }]));
        const devices = await handlers.list_devices();
        expect(devices.map((d) => d.data.vehicleId)).toEqual(['enode-1']);
    });
});
