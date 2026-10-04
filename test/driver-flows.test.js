const XpengDriver = require('../drivers/cars/driver');

function makeDriver() {
    const listeners = {};
    const card = (id) => ({
        registerRunListener: jest.fn((fn) => { listeners[id] = fn; }),
        trigger: jest.fn(),
    });
    const driver = Object.create(XpengDriver.prototype);
    Object.defineProperty(driver, 'homey', {
        value: {
            flow: {
                getDeviceTriggerCard: jest.fn(card),
                getConditionCard: jest.fn(card),
                getActionCard: jest.fn(card),
            },
        },
    });
    driver.log = jest.fn();
    driver.error = jest.fn();
    driver.registerFlowCards();
    return { driver, listeners };
}

const deviceWith = (capabilities) => ({
    getName: () => 'XPENG G6',
    getCapabilityValue: (id) => capabilities[id],
});

describe('driver flow cards', () => {
    let listeners;

    beforeEach(() => {
        ({ listeners } = makeDriver());
    });

    describe('range_check condition', () => {
        test('compares the numeric range (was always false)', async () => {
            const device = deviceWith({ range: 274 });
            await expect(listeners.range_check({ device, comparison: 'greater', value: 200 })).resolves.toBe(true);
            await expect(listeners.range_check({ device, comparison: 'lower', value: 200 })).resolves.toBe(false);
        });
    });

    describe('battery_level condition', () => {
        test('equals matches a decimal battery level to the whole number', async () => {
            const device = deviceWith({ batteryLevel: 50.4 });
            await expect(listeners.battery_level({ device, comparison: 'equals', value: 50 })).resolves.toBe(true);
        });
    });

    describe('charging_status condition', () => {
        test('matches Error now that the app can report it', async () => {
            const device = deviceWith({ chargingStatus: 'Error' });
            await expect(listeners.charging_status({ device, status: 'charging_error' })).resolves.toBe(true);
        });
    });

    describe('battery_low trigger', () => {
        test('runs once when the level drops below the threshold', async () => {
            await expect(listeners.battery_low({ threshold: 20 }, { battery_level: 19, previous_battery_level: 21 }))
                .resolves.toBe(true);
        });

        test('does not run again while the level stays low', async () => {
            await expect(listeners.battery_low({ threshold: 20 }, { battery_level: 18, previous_battery_level: 19 }))
                .resolves.toBe(false);
        });

        test('does not run while charging back up below the threshold', async () => {
            await expect(listeners.battery_low({ threshold: 20 }, { battery_level: 12, previous_battery_level: 11 }))
                .resolves.toBe(false);
        });
    });

    describe('range_low trigger', () => {
        test('runs once when range drops below the threshold', async () => {
            await expect(listeners.range_low({ threshold: 50 }, { range: 49.5, previous_range: 50.1 })).resolves.toBe(true);
        });

        test('does not run for small changes while already below', async () => {
            await expect(listeners.range_low({ threshold: 50 }, { range: 44.9, previous_range: 45 })).resolves.toBe(false);
        });
    });

    describe('charging_status_changed trigger', () => {
        test('runs only for the status selected on the card', async () => {
            const state = { current_status: 'Charge Complete' };
            await expect(listeners.charging_status_changed({ status: 'charging_complete' }, state)).resolves.toBe(true);
            await expect(listeners.charging_status_changed({ status: 'charging' }, state)).resolves.toBe(false);
        });
    });

    describe('location_changed trigger', () => {
        const args = { comparison: 'enters', latitude: 55.570267, longitude: 13.053961, radius: 100 };

        test('runs when the car enters the selected area', async () => {
            const state = {
                previous: { latitude: 55.60, longitude: 13.00 },
                current: { latitude: 55.5703, longitude: 13.0540 },
            };
            await expect(listeners.location_changed(args, state)).resolves.toBe(true);
        });

        test('does not run for movement somewhere else', async () => {
            const state = {
                previous: { latitude: 55.60, longitude: 13.00 },
                current: { latitude: 55.61, longitude: 13.00 },
            };
            await expect(listeners.location_changed(args, state)).resolves.toBe(false);
        });

        test('runs on exit for an exits card', async () => {
            const state = {
                previous: { latitude: 55.5703, longitude: 13.0540 },
                current: { latitude: 55.60, longitude: 13.00 },
            };
            await expect(listeners.location_changed({ ...args, comparison: 'exits' }, state)).resolves.toBe(true);
        });
    });
});
