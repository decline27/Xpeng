'use strict';

const XpengCarDevice = require('../../drivers/cars/device');

/**
 * Build an XpengCarDevice wired to in-memory fakes, without running onInit.
 * Capability values, store values and settings live in plain objects so tests can
 * inspect them. Timers go through a fake homey so tests control when they fire.
 * @param {Object} [options]
 * @param {Object} [options.capabilities] - initial capability values
 * @param {Object} [options.store] - initial store values
 * @param {Object} [options.settings] - initial settings
 * @param {Object} [options.enodeApi] - overrides for the fake EnodeAPI
 */
function makeDevice(options = {}) {
    const device = Object.create(XpengCarDevice.prototype);

    const capabilities = { ...(options.capabilities || {}) };
    const store = { ...(options.store || {}) };
    const settings = { updateInterval: 10, ...(options.settings || {}) };
    const triggers = {};
    const timers = [];

    const getTrigger = (id) => {
        if (!triggers[id]) {
            triggers[id] = { trigger: jest.fn().mockResolvedValue(true) };
        }
        return triggers[id];
    };

    const homey = {
        flow: { getDeviceTriggerCard: jest.fn(getTrigger) },
        notifications: { createNotification: jest.fn().mockResolvedValue(true) },
        clock: { getTimezone: () => 'Europe/Stockholm' },
        setTimeout: jest.fn((fn, ms) => {
            const timer = { fn, ms, cleared: false };
            timers.push(timer);
            return timer;
        }),
        clearTimeout: jest.fn((timer) => { if (timer) timer.cleared = true; }),
        setInterval: jest.fn((fn, ms) => {
            const timer = { fn, ms, cleared: false, interval: true };
            timers.push(timer);
            return timer;
        }),
        clearInterval: jest.fn((timer) => { if (timer) timer.cleared = true; }),
    };

    Object.defineProperty(device, 'homey', { value: homey, writable: true });

    device.log = jest.fn();
    device.error = jest.fn();
    device.getName = () => 'XPENG G6';
    device.getData = jest.fn(() => ({ id: 'vehicle-123', vehicleId: 'vehicle-123', vin: 'VIN123', ...(options.data || {}) }));
    device.getCapabilityValue = jest.fn((id) => capabilities[id]);
    device.setCapabilityValue = jest.fn(async (id, value) => { capabilities[id] = value; });
    device.hasCapability = jest.fn((id) => !(options.missingCapabilities || []).includes(id));
    device.addCapability = jest.fn().mockResolvedValue();
    device.removeCapability = jest.fn().mockResolvedValue();
    device.setCapabilityOptions = jest.fn().mockResolvedValue();
    device.getStoreValue = jest.fn((key) => store[key]);
    device.setStoreValue = jest.fn(async (key, value) => { store[key] = value; });
    device.unsetStoreValue = jest.fn(async (key) => { delete store[key]; });
    device.getStore = jest.fn(() => store);
    device.getSettings = jest.fn(() => settings);
    device.setSettings = jest.fn(async (values) => { Object.assign(settings, values); });
    device.setAvailable = jest.fn().mockResolvedValue();
    device.setUnavailable = jest.fn().mockResolvedValue();

    const vehicle = options.vehicle || {
        id: 'vehicle-123',
        lastSeen: '2026-10-04T19:27:00Z',
        information: { brand: 'XPENG', model: 'G6', year: 2026, vin: 'VIN123' },
        chargeState: { isPluggedIn: false, isCharging: false, batteryLevel: 59, range: 274, chargeLimit: 100 },
        odometer: { distance: 12345 },
        location: { latitude: 55.570267, longitude: 13.053961 },
    };

    device.enodeApi = {
        getVehicles: jest.fn().mockResolvedValue([vehicle]),
        getVehicleData: jest.fn().mockResolvedValue(vehicle),
        refreshVehicleData: jest.fn().mockResolvedValue(vehicle),
        startCharging: jest.fn().mockResolvedValue({ state: 'CONFIRMED' }),
        stopCharging: jest.fn().mockResolvedValue({ state: 'CONFIRMED' }),
        ...(options.enodeApi || {}),
    };

    const VehicleStore = require('../../lib/vehicle-store');
    device.vehicleStore = new VehicleStore(device);
    device.accountManager = {
        getVehicleAccount: jest.fn().mockReturnValue(null),
        setVehicleAccount: jest.fn(),
    };
    device.vehicleId = 'vehicle-123';
    device.updateInterval = settings.updateInterval;

    return { device, capabilities, store, settings, triggers, timers, homey, getTrigger, vehicle };
}

module.exports = { makeDevice };
