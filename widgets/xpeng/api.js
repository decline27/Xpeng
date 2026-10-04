'use strict';

const { buildWidgetData, findDevice, AddressLookup } = require('../../lib/widget-data');

const addressLookup = new AddressLookup();

/**
 * Find the car this widget instance shows.
 * @param {Object} homey
 * @param {string} [deviceId]
 * @returns {Promise<Object|null>}
 */
async function getDevice(homey, deviceId) {
    const driver = await homey.drivers.getDriver('cars');
    return findDevice(driver.getDevices(), deviceId);
}

const NO_VEHICLE = { error: 'No XPENG vehicle found. Add your car in Homey first.' };

module.exports = {
    /**
     * Current vehicle values for the widget. Reads the device's capabilities, which the device
     * keeps up to date with its own polling, so showing the widget never calls Enode.
     */
    async getVehicleData({ homey, query }) {
        try {
            const device = await getDevice(homey, query && query.deviceId);
            if (!device) return NO_VEHICLE;

            const data = buildWidgetData(device);
            data.address = data.location
                ? await addressLookup.lookup(data.location.latitude, data.location.longitude)
                : null;
            return data;
        } catch (error) {
            return { error: error.message };
        }
    },

    /**
     * Ask the device for fresh data from Enode.
     */
    async updateVehicleData({ homey, body }) {
        try {
            const device = await getDevice(homey, body && body.deviceId);
            if (!device) return NO_VEHICLE;
            const success = await device.refreshData();
            return success ? { success: true } : { error: 'Could not refresh vehicle data' };
        } catch (error) {
            return { error: error.message };
        }
    },

    async startCharging({ homey, body }) {
        try {
            const device = await getDevice(homey, body && body.deviceId);
            if (!device) return NO_VEHICLE;
            await device.startCharging();
            return { success: true };
        } catch (error) {
            return { error: error.message };
        }
    },

    async stopCharging({ homey, body }) {
        try {
            const device = await getDevice(homey, body && body.deviceId);
            if (!device) return NO_VEHICLE;
            await device.stopCharging();
            return { success: true };
        } catch (error) {
            return { error: error.message };
        }
    }
};
