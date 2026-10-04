jest.mock('../lib/duplicate-reaper', () => ({
    reapForVin: jest.fn().mockResolvedValue({ targets: [], disconnected: 0, failed: 0, executed: true }),
}));
jest.mock('../lib/user-identity', () => ({
    resolveUserId: jest.fn().mockResolvedValue('homey_stable'),
    getUserIdCandidates: jest.fn().mockResolvedValue(['homey_stable', 'homey_legacy']),
}));

const DuplicateReaper = require('../lib/duplicate-reaper');
const XpengDriver = require('../drivers/cars/driver');

function makeDriver() {
    const driver = Object.create(XpengDriver.prototype);
    Object.defineProperty(driver, 'homey', {
        value: { settings: { get: jest.fn().mockReturnValue(undefined), set: jest.fn() } },
    });
    driver.log = jest.fn();
    driver.error = jest.fn();
    driver.enodeApi = { requestCache: { clear: jest.fn() } };
    return driver;
}

describe('driver auto-reap on pairing', () => {
    test('only reaps this Homey\'s own Enode users and keeps the newly added vehicle', async () => {
        const driver = makeDriver();

        await driver._autoReapDuplicates('VIN123', 'vehicle-new');

        expect(DuplicateReaper.reapForVin).toHaveBeenCalledWith(
            driver.enodeApi,
            'VIN123',
            expect.objectContaining({
                ownerUserIds: ['homey_stable', 'homey_legacy'],
                keepVehicleId: 'vehicle-new',
            }),
        );
    });
});
