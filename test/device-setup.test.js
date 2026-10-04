const { makeDevice } = require('./helpers/device-harness');
const VehicleStore = require('../lib/vehicle-store');

const MIN = 60 * 1000;

function prepareInit(harness, { getClass = 'sensor' } = {}) {
    const { device } = harness;
    device.getClass = jest.fn(() => getClass);
    device.setClass = jest.fn().mockResolvedValue();
    device.createServices = jest.fn(); // keep the harness fakes instead of real API clients
    return harness;
}

describe('device class and Homey Energy', () => {
    test('existing devices are migrated to the car class', async () => {
        const { device } = prepareInit(makeDevice());
        await device.onInit();
        expect(device.setClass).toHaveBeenCalledWith('car');
    });

    test('devices already in the car class are left alone', async () => {
        const { device } = prepareInit(makeDevice(), { getClass: 'car' });
        await device.onInit();
        expect(device.setClass).not.toHaveBeenCalled();
    });

    test('standard battery, power and EV charging capabilities are added to existing devices', async () => {
        const { device } = prepareInit(makeDevice({ missingCapabilities: ['measure_battery', 'measure_power', 'ev_charging_state'] }));
        await device.onInit();
        expect(device.addCapability).toHaveBeenCalledWith('measure_battery');
        expect(device.addCapability).toHaveBeenCalledWith('measure_power');
        expect(device.addCapability).toHaveBeenCalledWith('ev_charging_state');
    });

    test.each([
        [{ isPluggedIn: true, isCharging: true }, 'plugged_in_charging'],
        [{ isPluggedIn: false, isCharging: false }, 'plugged_out'],
        [{ isPluggedIn: true, isCharging: false }, 'plugged_in'],
        [{ isPluggedIn: true, isCharging: false, powerDeliveryState: 'PLUGGED_IN:STOPPED' }, 'plugged_in_paused'],
        [{ isPluggedIn: true, isCharging: false, powerDeliveryState: 'PLUGGED_IN:DISCHARGING' }, 'plugged_in_discharging'],
        [{ isPluggedIn: null, isCharging: null }, undefined],
    ])('charge state %j maps to ev_charging_state %s', (chargeState, expected) => {
        const store = new VehicleStore(makeDevice().device);
        expect(store.processDynamicData({ chargeState }).ev_charging_state).toBe(expected);
    });

    test('measure_battery mirrors the battery level', () => {
        const store = new VehicleStore(makeDevice().device);
        expect(store.processDynamicData({ chargeState: { batteryLevel: 59 } }).measure_battery).toBe(59);
    });
});

describe('device identity storage', () => {
    test('the vehicle id in the store wins over a hidden legacy setting', async () => {
        const { device } = prepareInit(makeDevice({
            settings: { vehicleId: 'old-id' },
            store: { vehicleId: 'vehicle-123' },
        }));
        await device.onInit();
        expect(device.vehicleId).toBe('vehicle-123');
    });

    test('a legacy vehicleId setting is moved into the store', async () => {
        const harness = prepareInit(makeDevice({ settings: { vehicleId: 'vehicle-123' } }));
        await harness.device.onInit();
        expect(harness.store.vehicleId).toBe('vehicle-123');
    });

    test('static vehicle data is kept in the store, not in settings', async () => {
        const { device, store } = makeDevice();
        await device.vehicleStore.storeStaticData({ information: { brand: 'XPENG', model: 'G6', vin: 'VIN123' } });
        expect(JSON.parse(store.storedVehicleData).vehicleModel).toBe('G6');
        expect(device.setSettings).not.toHaveBeenCalledWith(expect.objectContaining({ storedVehicleData: expect.anything() }));
    });

    test('static vehicle data saved in settings by older versions is still loaded', async () => {
        const { device } = makeDevice({ settings: { storedVehicleData: JSON.stringify({ vehicleModel: 'P7' }) } });
        await device.vehicleStore.loadStaticData();
        expect(device.vehicleStore.getStaticData().vehicleModel).toBe('P7');
    });
});

describe('device information settings', () => {
    test('a poll fills the read-only vehicle information labels', async () => {
        const { device, settings } = makeDevice({
            store: { lastDataUpdate: Date.now(), wasPluggedIn: false },
            capabilities: { chargingStatus: 'Not Connected', pluggedInStatus: false },
        });

        await device.pollVehicleData();

        expect(settings.info_vehicle_id).toBe('vehicle-123');
        expect(settings.info_vin).toBe('VIN123');
        expect(settings.info_last_sync).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });
});

describe('distance unit setting', () => {
    test('miles converts range and odometer and switches the capability units', async () => {
        const { device, capabilities } = makeDevice({
            store: { lastDataUpdate: Date.now(), wasPluggedIn: false },
            capabilities: { chargingStatus: 'Not Connected', pluggedInStatus: false },
        });

        await device.onSettings({ oldSettings: { distanceUnit: 'km' }, newSettings: { distanceUnit: 'mi' }, changedKeys: ['distanceUnit'] });
        await device.pollVehicleData();

        expect(device.setCapabilityOptions).toHaveBeenCalledWith('range', expect.objectContaining({ units: { en: 'mi' } }));
        expect(device.setCapabilityOptions).toHaveBeenCalledWith('odometer', expect.objectContaining({ units: { en: 'mi' } }));
        expect(capabilities.range).toBeCloseTo(274 * 0.621371, 1);
        expect(capabilities.odometer).toBe(Math.round(12345 * 0.621371));
    });

    test('kilometres is the default', async () => {
        const { device, capabilities } = makeDevice({
            store: { lastDataUpdate: Date.now(), wasPluggedIn: false },
            capabilities: { chargingStatus: 'Not Connected', pluggedInStatus: false },
        });
        await device.pollVehicleData();
        expect(capabilities.range).toBe(274);
    });
});

describe('onSettings', () => {
    test('a failing poll after changing the interval does not reject the settings change', async () => {
        const { device } = makeDevice();
        device.pollVehicleData = jest.fn().mockRejectedValue(new Error('offline'));
        await expect(device.onSettings({
            oldSettings: { updateInterval: 10 }, newSettings: { updateInterval: 20 }, changedKeys: ['updateInterval'],
        })).resolves.not.toThrow();
    });

    test('changing the interval reschedules polling with the new value', async () => {
        // Homey calls onSettings before saving, so getSettings() still returns the old value
        const { device, homey } = makeDevice({ capabilities: { chargingStatus: 'Connected' } });
        device.pollVehicleData = jest.fn().mockResolvedValue(true);

        await device.onSettings({ oldSettings: { updateInterval: 10 }, newSettings: { updateInterval: 20 }, changedKeys: ['updateInterval'] });

        expect(homey.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 20 * MIN);
    });
});

describe('startup resilience', () => {
    test('a network error during startup schedules a retry instead of giving up', async () => {
        const harness = prepareInit(makeDevice({
            enodeApi: { getVehicles: jest.fn().mockRejectedValue(new Error('ECONNRESET')) },
        }));
        const { device, homey } = harness;

        await device.onInit();

        expect(device.setUnavailable).toHaveBeenCalled();
        expect(homey.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1 * MIN);
    });

    test('the retry finishes setup once Enode is reachable again', async () => {
        const vehicle = { id: 'vehicle-123', information: { vin: 'VIN123' }, chargeState: {} };
        const getVehicles = jest.fn()
            .mockRejectedValueOnce(new Error('ECONNRESET'))
            .mockResolvedValue([vehicle]);
        const harness = prepareInit(makeDevice({ enodeApi: { getVehicles } }));
        const { device, homey } = harness;

        await device.onInit();
        const retry = homey.setTimeout.mock.calls.find(([, ms]) => ms === 1 * MIN)[0];
        await retry();

        expect(device.setAvailable).toHaveBeenCalled();
        expect(device.pollTimeout).toBeTruthy();
    });

    test('retries back off: 1, 5, 15, 30 then 60 minutes', () => {
        const { device } = makeDevice();
        expect([0, 1, 2, 3, 4, 9].map((n) => device.initRetryDelayMs(n)))
            .toEqual([1, 5, 15, 30, 60, 60].map((m) => m * MIN));
    });
});

describe('health check', () => {
    test('notifies once per outage, not every day', async () => {
        const { device, homey } = makeDevice({ store: { lastDataUpdate: Date.now() - 3 * 60 * MIN } });
        device.refreshData = jest.fn().mockResolvedValue(false);

        await device.runHealthCheck();
        await device.runHealthCheck();

        expect(homey.notifications.createNotification).toHaveBeenCalledTimes(1);
    });

    test('notifies again for a new outage after a successful poll', async () => {
        const { device, homey, store } = makeDevice({ store: { lastDataUpdate: Date.now() - 3 * 60 * MIN } });
        device.refreshData = jest.fn().mockResolvedValue(false);

        await device.runHealthCheck();
        await device.markDataReceived();
        store.lastDataUpdate = Date.now() - 3 * 60 * MIN;
        await device.runHealthCheck();

        expect(homey.notifications.createNotification).toHaveBeenCalledTimes(2);
    });
});
