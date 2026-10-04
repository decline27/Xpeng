const { makeDevice } = require('./helpers/device-harness');

const MIN = 60 * 1000;

describe('device polling', () => {
    describe('refresh-hint (waking the car)', () => {
        test('is not used for an idle, unplugged car with recent data', async () => {
            const { device } = makeDevice({
                capabilities: { chargingStatus: 'Not Connected', pluggedInStatus: false },
                store: { lastDataUpdate: Date.now() - 5 * MIN, wasPluggedIn: false },
            });

            await device.pollVehicleData();

            expect(device.enodeApi.refreshVehicleData).not.toHaveBeenCalled();
            expect(device.enodeApi.getVehicleData).toHaveBeenCalledTimes(1);
        });

        test('is used while the car is charging', async () => {
            const { device } = makeDevice({
                capabilities: { chargingStatus: 'Charging', pluggedInStatus: true },
                store: { lastDataUpdate: Date.now() - 5 * MIN, wasPluggedIn: true },
            });

            await device.pollVehicleData();

            expect(device.enodeApi.refreshVehicleData).toHaveBeenCalledTimes(1);
        });
    });

    describe('poll scheduling', () => {
        test('schedules the next poll after the configured interval when idle', () => {
            const { device, homey } = makeDevice({ capabilities: { chargingStatus: 'Connected' } });

            device.scheduleNextPoll();

            expect(homey.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 10 * MIN);
        });

        test('schedules the next poll after 5 minutes while charging', () => {
            const { device, homey } = makeDevice({ capabilities: { chargingStatus: 'Charging' } });

            device.scheduleNextPoll();

            expect(homey.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 5 * MIN);
        });

        test('polls when the timer fires and then schedules the following poll', async () => {
            const { device, homey } = makeDevice({ capabilities: { chargingStatus: 'Connected' } });
            device.pollVehicleData = jest.fn().mockResolvedValue(true);

            device.scheduleNextPoll();
            await homey.setTimeout.mock.calls[0][0]();

            expect(device.pollVehicleData).toHaveBeenCalledTimes(1);
            expect(homey.setTimeout).toHaveBeenCalledTimes(2);
        });

        test('keeps scheduling after a failed poll', async () => {
            const { device, homey } = makeDevice({ capabilities: { chargingStatus: 'Connected' } });
            device.pollVehicleData = jest.fn().mockRejectedValue(new Error('network down'));

            device.scheduleNextPoll();
            await homey.setTimeout.mock.calls[0][0]();

            expect(homey.setTimeout).toHaveBeenCalledTimes(2);
        });

        test('replaces a pending poll timer instead of stacking a second one', () => {
            const { device, timers } = makeDevice({ capabilities: { chargingStatus: 'Connected' } });

            device.scheduleNextPoll();
            device.scheduleNextPoll();

            expect(timers.filter((t) => !t.cleared)).toHaveLength(1);
        });

        test('does not schedule again when the device was deleted during a poll', async () => {
            const { device, homey } = makeDevice({ capabilities: { chargingStatus: 'Connected' } });
            let finishPoll;
            device.pollVehicleData = jest.fn(() => new Promise((resolve) => { finishPoll = resolve; }));

            device.scheduleNextPoll();
            const running = homey.setTimeout.mock.calls[0][0]();
            await device.onDeleted();
            finishPoll(true);
            await running;

            expect(homey.setTimeout).toHaveBeenCalledTimes(1);
        });
    });
});
