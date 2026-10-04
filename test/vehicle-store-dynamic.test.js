const VehicleStore = require('../lib/vehicle-store');

function makeDevice(timezone = 'Europe/Stockholm') {
    return {
        log: jest.fn(),
        error: jest.fn(),
        getData: jest.fn().mockReturnValue({ id: 'vehicle-123' }),
        getSettings: jest.fn().mockReturnValue({}),
        setSettings: jest.fn().mockResolvedValue(true),
        getStoreValue: jest.fn(),
        setStoreValue: jest.fn().mockResolvedValue(true),
        homey: { clock: { getTimezone: () => timezone } },
    };
}

describe('VehicleStore.processDynamicData', () => {
    let store;

    beforeEach(() => {
        store = new VehicleStore(makeDevice());
    });

    describe('odometer', () => {
        test('is a number so the numeric capability accepts it', () => {
            const out = store.processDynamicData({ odometer: { distance: 12345 } });
            expect(out.odometer).toBe(12345);
        });

        test('is null when Enode does not report it', () => {
            expect(store.processDynamicData({}).odometer).toBeNull();
            expect(store.processDynamicData({ odometer: { distance: null } }).odometer).toBeNull();
        });
    });

    describe('lastSeen', () => {
        test('is formatted in the Homey timezone, not UTC', () => {
            // 19:27 UTC is 21:27 in Stockholm during summer time
            const out = store.processDynamicData({ lastSeen: '2026-10-04T19:27:00Z' });
            expect(out.lastSeen).toBe('2026-10-04 21:27');
        });

        test('falls back to a labelled UTC time when the timezone is unavailable', () => {
            const device = makeDevice();
            device.homey = undefined;
            const utcStore = new VehicleStore(device);
            const out = utcStore.processDynamicData({ lastSeen: '2026-10-04T19:27:00Z' });
            expect(out.lastSeen).toBe('2026-10-04 19:27 UTC');
        });
    });

    describe('location', () => {
        test('uses S/W hemisphere labels for negative coordinates', () => {
            const out = store.processDynamicData({ location: { latitude: -33.8688, longitude: -70.6483 } });
            expect(out.location).toBe('33.869°S, 70.648°W (-33.8688,-70.6483)');
        });

        test('uses N/E hemisphere labels for positive coordinates', () => {
            const out = store.processDynamicData({ location: { latitude: 55.570267, longitude: 13.053961 } });
            expect(out.location).toBe('55.570°N, 13.054°E (55.570267,13.053961)');
        });

        test('treats a latitude or longitude of exactly 0 as a real coordinate', () => {
            const out = store.processDynamicData({ location: { latitude: 0, longitude: 9.5 } });
            expect(out.location).toBe('0.000°N, 9.500°E (0,9.5)');
        });

        test('reports Not Available when coordinates are missing', () => {
            expect(store.processDynamicData({ location: { latitude: null, longitude: null } }).location)
                .toBe('Not Available');
        });
    });

    describe('charge power', () => {
        test('treats Enode chargeRate as kW and exposes measure_power in W', () => {
            const out = store.processDynamicData({
                chargeState: { isPluggedIn: true, isCharging: true, chargeRate: 11 },
            });
            expect(out.measure_power).toBe(11000);
        });

        test('reports 0 W when not charging', () => {
            const out = store.processDynamicData({
                chargeState: { isPluggedIn: true, isCharging: false, chargeRate: 11 },
            });
            expect(out.measure_power).toBe(0);
        });
    });

    describe('power delivery state', () => {
        test.each([
            ['UNPLUGGED', 'Unplugged'],
            ['PLUGGED_IN:INITIALIZING', 'Initializing'],
            ['PLUGGED_IN:CHARGING', 'Charging'],
            ['PLUGGED_IN:STOPPED', 'Stopped'],
            ['PLUGGED_IN:COMPLETE', 'Complete'],
            ['PLUGGED_IN:NO_POWER', 'No Power'],
            ['PLUGGED_IN:FAULT', 'Fault'],
            ['PLUGGED_IN:DISCHARGING', 'Discharging'],
        ])('maps Enode %s to %s', (enodeState, label) => {
            const out = store.processDynamicData({ chargeState: { powerDeliveryState: enodeState } });
            expect(out.powerDeliveryState).toBe(label);
        });

        test('derives a label from the booleans when Enode gives no state', () => {
            expect(store.processDynamicData({ chargeState: { isPluggedIn: false } }).powerDeliveryState)
                .toBe('Unplugged');
            expect(store.processDynamicData({ chargeState: { isPluggedIn: true, isCharging: true } }).powerDeliveryState)
                .toBe('Charging');
            expect(store.processDynamicData({ chargeState: { isPluggedIn: true, isCharging: false } }).powerDeliveryState)
                .toBe('Plugged In');
        });
    });

    describe('charging status', () => {
        test('uses Enode powerDeliveryState FAULT as Error', () => {
            const out = store.processDynamicData({
                chargeState: { isPluggedIn: true, isCharging: false, powerDeliveryState: 'PLUGGED_IN:FAULT' },
            });
            expect(out.chargingStatus).toBe('Error');
        });

        test('uses Enode powerDeliveryState COMPLETE as Charge Complete', () => {
            const out = store.processDynamicData({
                chargeState: { isPluggedIn: true, isCharging: false, powerDeliveryState: 'PLUGGED_IN:COMPLETE' },
            });
            expect(out.chargingStatus).toBe('Charge Complete');
        });

        test('uses isFullyCharged as Charge Complete', () => {
            const out = store.processDynamicData({
                chargeState: { isPluggedIn: true, isCharging: false, isFullyCharged: true },
            });
            expect(out.chargingStatus).toBe('Charge Complete');
        });
    });

    describe('unknown plug state (Enode returns null while the car is unreachable)', () => {
        test('leaves pluggedInStatus and chargingStatus undefined so the previous values are kept', () => {
            const out = store.processDynamicData({
                chargeState: { isPluggedIn: null, isCharging: null, batteryLevel: 60 },
            });
            expect(out.pluggedInStatus).toBeUndefined();
            expect(out.chargingStatus).toBeUndefined();
            expect(out.batteryLevel).toBe(60);
        });
    });
});
