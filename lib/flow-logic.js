'use strict';

const EARTH_RADIUS_M = 6371000;
const EFFICIENCY_SMOOTHING = 0.2; // weight of a new km-per-% sample
const MIN_BATTERY_FOR_EFFICIENCY = 10; // range estimates near empty are unreliable

const toNumber = (value) => (typeof value === 'number' ? value : parseFloat(value));

/**
 * Compare a capability value against a flow card argument.
 * "equals" compares whole numbers so a 50.4% battery equals 50.
 * @param {number} value
 * @param {'greater'|'lower'|'equals'} comparison
 * @param {number} target
 * @returns {boolean}
 */
function compareNumber(value, comparison, target) {
    const number = toNumber(value);
    if (value === null || value === undefined || Number.isNaN(number)) return false;
    switch (comparison) {
        case 'greater': return number > target;
        case 'lower': return number < target;
        case 'equals': return Math.round(number) === Math.round(target);
        default: return false;
    }
}

/**
 * True only on the poll where the value drops below the threshold, so low-battery and
 * low-range flows run once instead of on every reading below it.
 * @param {number|null} previous
 * @param {number} current
 * @param {number} threshold
 * @returns {boolean}
 */
function crossedBelow(previous, current, threshold) {
    if (previous === null || previous === undefined) return false;
    const prev = toNumber(previous);
    const curr = toNumber(current);
    if (Number.isNaN(prev) || Number.isNaN(curr)) return false;
    return prev >= threshold && curr < threshold;
}

/**
 * Match a charging status dropdown option against the chargingStatus capability value.
 * @param {string} option - dropdown id from the flow card
 * @param {string} status - capability value
 * @returns {boolean}
 */
function matchesChargingStatus(option, status) {
    switch (option) {
        case 'charging': return status === 'Charging';
        case 'not_charging': return status === 'Connected' || status === 'Not Connected';
        case 'charging_complete': return status === 'Charge Complete';
        case 'charging_error': return status === 'Error';
        default: return false;
    }
}

/**
 * Read coordinates from the location capability ("… (lat,lng)").
 * @param {string} location
 * @returns {{latitude:number, longitude:number}|null}
 */
function parseCoordinates(location) {
    if (typeof location !== 'string') return null;
    const match = location.match(/\(([-\d.]+),([-\d.]+)\)/);
    if (!match) return null;
    const latitude = parseFloat(match[1]);
    const longitude = parseFloat(match[2]);
    return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

/**
 * Great-circle distance between two points (haversine).
 * @returns {number} metres
 */
function distanceMeters(lat1, lon1, lat2, lon2) {
    const rad = (deg) => (deg * Math.PI) / 180;
    const dLat = rad(lat2 - lat1);
    const dLon = rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Whether a move from `previous` to `current` enters or exits the circle around `target`.
 * @param {{latitude:number, longitude:number}|null} previous
 * @param {{latitude:number, longitude:number}|null} current
 * @param {{latitude:number, longitude:number, radius:number}} target
 * @param {'enters'|'exits'} direction
 * @returns {boolean}
 */
function geofenceTransition(previous, current, target, direction) {
    if (!previous || !current || !target) return false;
    const inside = (point) => distanceMeters(point.latitude, point.longitude, target.latitude, target.longitude)
        <= target.radius;
    const wasInside = inside(previous);
    const isInside = inside(current);
    if (direction === 'enters') return !wasInside && isInside;
    if (direction === 'exits') return wasInside && !isInside;
    return false;
}

/**
 * Minutes until the charge limit is reached at the current charge power.
 * @param {{batteryLevel:number, chargeLimit:number, capacityKwh:number, powerW:number}} input
 * @returns {number} whole minutes, 0 when not charging or already at the limit
 */
function predictChargingMinutes({ batteryLevel, chargeLimit, capacityKwh, powerW } = {}) {
    const battery = toNumber(batteryLevel);
    const limit = Number.isFinite(toNumber(chargeLimit)) ? toNumber(chargeLimit) : 100;
    const capacity = toNumber(capacityKwh);
    const power = toNumber(powerW);
    if (![battery, capacity, power].every(Number.isFinite) || power <= 0 || battery >= limit) {
        return 0;
    }
    const remainingKwh = ((limit - battery) / 100) * capacity;
    return Math.round((remainingKwh / (power / 1000)) * 60);
}

/**
 * Update the learned km-per-battery-% with a new reading (exponential moving average).
 * @param {number|null} current - stored efficiency
 * @param {{batteryLevel:number, range:number}} sample
 * @returns {number|null}
 */
function updateEfficiency(current, { batteryLevel, range } = {}) {
    const battery = toNumber(batteryLevel);
    const km = toNumber(range);
    if (!Number.isFinite(battery) || !Number.isFinite(km) || battery < MIN_BATTERY_FOR_EFFICIENCY || km <= 0) {
        return current === undefined ? null : current;
    }
    const sample = km / battery;
    if (!Number.isFinite(current) || current === null) return sample;
    return current + EFFICIENCY_SMOOTHING * (sample - current);
}

/**
 * Predicted range after charging to the charge limit.
 * @param {{efficiency:number|null, chargeLimit:number, batteryLevel:number, range:number}} input
 * @returns {number} km
 */
function predictRangeAtLimit({ efficiency, chargeLimit, batteryLevel, range } = {}) {
    const limit = Number.isFinite(toNumber(chargeLimit)) ? toNumber(chargeLimit) : 100;
    let kmPerPercent = toNumber(efficiency);
    if (!Number.isFinite(kmPerPercent) || kmPerPercent <= 0) {
        const battery = toNumber(batteryLevel);
        const km = toNumber(range);
        kmPerPercent = Number.isFinite(battery) && battery > 0 && Number.isFinite(km) ? km / battery : null;
    }
    if (!kmPerPercent) {
        const km = toNumber(range);
        return Number.isFinite(km) ? Math.round(km) : 0;
    }
    return Math.round(kmPerPercent * limit);
}

module.exports = {
    compareNumber,
    crossedBelow,
    matchesChargingStatus,
    parseCoordinates,
    distanceMeters,
    geofenceTransition,
    predictChargingMinutes,
    updateEfficiency,
    predictRangeAtLimit
};
