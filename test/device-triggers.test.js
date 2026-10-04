const { makeDevice } = require('./helpers/device-harness');

const changes = (entries) => new Map(Object.entries(entries));

describe('device flow triggers', () => {
    test('battery_low gets the previous level so it can fire only on the crossing', async () => {
        const { device, getTrigger } = makeDevice();

        await device.handleFlowTriggers(changes({ batteryLevel: { oldValue: 21, newValue: 19 } }));

        expect(getTrigger('battery_low').trigger).toHaveBeenCalledWith(
            device,
            { battery_level: 19 },
            { battery_level: 19, previous_battery_level: 21 },
        );
    });

    test('range_low gets the previous range and keeps decimals', async () => {
        const { device, getTrigger } = makeDevice();

        await device.handleFlowTriggers(changes({ range: { oldValue: 50.1, newValue: 49.5 } }));

        expect(getTrigger('range_low').trigger).toHaveBeenCalledWith(
            device,
            { range: 49.5 },
            { range: 49.5, previous_range: 50.1 },
        );
    });

    test('charging_status_changed passes the new status for the per-flow status filter', async () => {
        const { device, getTrigger } = makeDevice();

        await device.handleFlowTriggers(changes({ chargingStatus: { oldValue: 'Connected', newValue: 'Charging' } }));

        expect(getTrigger('charging_status_changed').trigger).toHaveBeenCalledWith(
            device,
            { previous_status: 'Connected', current_status: 'Charging' },
            { current_status: 'Charging' },
        );
        expect(getTrigger('charging_started').trigger).toHaveBeenCalled();
    });

    test('location_changed passes previous and current coordinates and the distance moved', async () => {
        const { device, getTrigger } = makeDevice();

        await device.handleFlowTriggers(changes({
            location: {
                oldValue: '55.600°N, 13.000°E (55.6,13.0)',
                newValue: '55.570°N, 13.054°E (55.570267,13.053961)',
            },
        }));

        const [, tokens, state] = getTrigger('location_changed').trigger.mock.calls[0];
        expect(Object.keys(tokens)).toEqual(['distance']);
        expect(tokens.distance).toBeGreaterThan(4000);
        expect(state.previous).toEqual({ latitude: 55.6, longitude: 13.0 });
        expect(state.current).toEqual({ latitude: 55.570267, longitude: 13.053961 });
    });

    test('location_changed does not fire when the new location is unavailable', async () => {
        const { device, getTrigger } = makeDevice();

        await device.handleFlowTriggers(changes({
            location: { oldValue: '55.600°N, 13.000°E (55.6,13.0)', newValue: 'Not Available' },
        }));

        expect(getTrigger('location_changed').trigger).not.toHaveBeenCalled();
    });

    test('a failing trigger does not stop the other triggers', async () => {
        const { device, getTrigger } = makeDevice();
        getTrigger('battery_level_changed').trigger.mockRejectedValue(new Error('invalid token'));

        await device.handleFlowTriggers(changes({
            batteryLevel: { oldValue: 50, newValue: 51 },
            chargingStatus: { oldValue: 'Connected', newValue: 'Charging' },
            pluggedInStatus: { oldValue: false, newValue: true },
        }));

        expect(getTrigger('charging_started').trigger).toHaveBeenCalled();
        expect(getTrigger('plugged_in').trigger).toHaveBeenCalled();
    });
});

describe('device charging commands', () => {
    test('startCharging succeeds even if the follow-up refresh fails', async () => {
        const { device } = makeDevice();
        device.pollVehicleData = jest.fn().mockRejectedValue(new Error('rate limited'));

        await expect(device.startCharging()).resolves.not.toThrow();
        expect(device.homey.notifications.createNotification).not.toHaveBeenCalled();
    });

    test('stopCharging succeeds even if the follow-up refresh fails', async () => {
        const { device } = makeDevice();
        device.pollVehicleData = jest.fn().mockRejectedValue(new Error('rate limited'));

        await expect(device.stopCharging()).resolves.not.toThrow();
    });

    test('a failed charge command is reported to the flow and the timeline', async () => {
        const { device } = makeDevice({
            enodeApi: { startCharging: jest.fn().mockRejectedValue(new Error('Vehicle is not plugged in')) },
        });

        await expect(device.startCharging()).rejects.toThrow(/charger/);
        expect(device.homey.notifications.createNotification).toHaveBeenCalledTimes(1);
    });
});

describe('device refresh', () => {
    test('a failed refresh does not post a timeline notification (the flow shows the error)', async () => {
        const { device } = makeDevice();
        device.pollVehicleData = jest.fn().mockRejectedValue(new Error('offline'));

        await expect(device.refreshData()).resolves.toBe(false);
        expect(device.homey.notifications.createNotification).not.toHaveBeenCalled();
    });
});

describe('device predictions', () => {
    test('predictChargingTime uses chargingPower instead of the text state', async () => {
        const { device } = makeDevice({
            capabilities: {
                batteryLevel: 60, chargingLimit: 80, batteryCapacity: 67.8,
                chargingPower: 11000, powerDeliveryState: 'Charging',
            },
        });

        await expect(device.predictChargingTime()).resolves.toBe(74);
    });

    test('predictRange uses the efficiency learned from earlier polls', async () => {
        const { device } = makeDevice({
            capabilities: { batteryLevel: 59, range: 274, chargingLimit: 80 },
            store: { rangeEfficiency: 4.6 },
        });

        await expect(device.predictRange()).resolves.toBe(368);
    });

    test('a poll updates the learned efficiency', async () => {
        const { device, store } = makeDevice({
            store: { lastDataUpdate: Date.now(), wasPluggedIn: false },
            capabilities: { chargingStatus: 'Not Connected', pluggedInStatus: false },
        });

        await device.pollVehicleData();

        expect(store.rangeEfficiency).toBeCloseTo(274 / 59, 5);
    });
});
