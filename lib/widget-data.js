'use strict';

const fetch = require('node-fetch');

const USER_AGENT = 'XPENG-Car-Manager-Homey-App (+https://github.com/decline27/Xpeng)';
const GEOCODER_TIMEOUT_MS = 5000;
const ADDRESS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Extract coordinates from a location capability value like "55.570°N, 13.054°E (55.57,13.05)".
 * @param {string} value
 * @returns {{latitude:number, longitude:number}|null}
 */
function parseLocation(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(/\(([-\d.]+),([-\d.]+)\)/);
    if (!match) return null;
    const latitude = parseFloat(match[1]);
    const longitude = parseFloat(match[2]);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

/**
 * Build the widget payload from a device's current capability values.
 * Reads only what the device already has, so showing the widget never calls Enode.
 * @param {Object} device - XpengCarDevice
 * @returns {Object}
 */
function buildWidgetData(device) {
    const value = (id) => {
        const v = device.getCapabilityValue(id);
        return v === undefined ? null : v;
    };

    const chargingStatus = value('chargingStatus');
    const pluggedInStatus = value('pluggedInStatus') === true;
    const isCharging = chargingStatus === 'Charging';
    const watts = value('chargingPower');

    return {
        name: typeof device.getName === 'function' ? device.getName() : null,
        vehicleModel: value('vehicleModel'),
        batteryLevel: value('batteryLevel'),
        range: value('range'),
        chargingStatus,
        pluggedInStatus,
        lastSeen: value('lastSeen'),
        powerDeliveryState: value('powerDeliveryState'),
        chargingPowerKw: typeof watts === 'number' ? Math.round(watts / 100) / 10 : null,
        isCharging,
        canStartCharging: pluggedInStatus && !isCharging,
        location: parseLocation(value('location'))
    };
}

/**
 * Pick the car the widget was configured for, or the first car for widgets that have no
 * device selected (instances created before device selection existed).
 * @param {Array} devices
 * @param {string} [deviceId] - Homey device id from Homey.getDeviceIds()
 * @returns {Object|null}
 */
function findDevice(devices, deviceId) {
    if (!devices || devices.length === 0) return null;
    if (deviceId) {
        const match = devices.find((d) => typeof d.getId === 'function' && d.getId() === deviceId);
        if (match) return match;
    }
    return devices[0];
}

/**
 * Reverse geocoding through OpenStreetMap Nominatim with a small bounded cache.
 * Coordinates are rounded to ~10 m before they leave Homey.
 */
class AddressLookup {
    /**
     * @param {{maxEntries?:number}} [options]
     */
    constructor({ maxEntries = 50 } = {}) {
        this.maxEntries = maxEntries;
        this.cache = new Map(); // key -> { address, timestamp }, oldest first
    }

    get size() {
        return this.cache.size;
    }

    /**
     * @param {number} lat
     * @param {number} lon
     * @returns {Promise<string|null>}
     */
    async lookup(lat, lon) {
        const roundedLat = Math.round(lat * 10000) / 10000;
        const roundedLon = Math.round(lon * 10000) / 10000;
        const key = `${roundedLat},${roundedLon}`;

        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < ADDRESS_TTL_MS) {
            return cached.address;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), GEOCODER_TIMEOUT_MS);
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${roundedLat}&lon=${roundedLon}&zoom=18&addressdetails=1`,
                { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal }
            );
            if (!response.ok) return null;

            const data = await response.json();
            const address = data && data.address;
            if (!address) return null;

            const parts = [address.road, address.house_number, address.postcode, address.city || address.town || address.village]
                .filter(Boolean);
            if (parts.length === 0) return null;

            const formatted = parts.join(', ');
            this.cache.delete(key);
            this.cache.set(key, { address: formatted, timestamp: Date.now() });
            while (this.cache.size > this.maxEntries) {
                this.cache.delete(this.cache.keys().next().value);
            }
            return formatted;
        } catch (error) {
            return null;
        } finally {
            clearTimeout(timeout);
        }
    }
}

module.exports = {
    parseLocation,
    buildWidgetData,
    findDevice,
    AddressLookup
};
