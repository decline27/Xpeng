'use strict';

const MINUTE_MS = 60 * 1000;
const MIN_IDLE_INTERVAL_MINUTES = 10;
const MAX_CHARGING_INTERVAL_MS = 5 * MINUTE_MS;
const STALE_DATA_MS = 30 * MINUTE_MS;

/**
 * Decide whether a poll should send Enode's refresh-hint, which wakes the car.
 * Waking costs 12V battery, so only do it when fresh data actually matters.
 * @param {Object} state
 * @param {string|null} state.chargingStatus - current chargingStatus capability value
 * @param {boolean|null} state.pluggedIn - current pluggedInStatus capability value
 * @param {boolean|null} state.wasPluggedIn - plug state stored at the previous poll
 * @param {number|null} state.lastDataUpdate - ms timestamp of the last successful poll
 * @param {number} state.now - current ms timestamp
 * @returns {boolean}
 */
function shouldUseRefreshHint({ chargingStatus, pluggedIn, wasPluggedIn, lastDataUpdate, now }) {
    if (chargingStatus === 'Charging') return true;
    if (wasPluggedIn === true && pluggedIn === false) return true;
    if (!lastDataUpdate) return true;
    return now - lastDataUpdate > STALE_DATA_MS;
}

/**
 * Delay until the next poll. Charging polls run faster than idle polls so charge
 * started/stopped/complete triggers arrive on time.
 * @param {Object} options
 * @param {number} options.intervalMinutes - the user's update interval setting
 * @param {boolean} options.charging - whether the car is currently charging
 * @returns {number} delay in ms
 */
function nextPollDelayMs({ intervalMinutes, charging }) {
    const minutes = Number.isFinite(intervalMinutes)
        ? Math.max(MIN_IDLE_INTERVAL_MINUTES, intervalMinutes)
        : MIN_IDLE_INTERVAL_MINUTES;
    const idleMs = minutes * MINUTE_MS;
    return charging ? Math.min(idleMs / 2, MAX_CHARGING_INTERVAL_MS) : idleMs;
}

module.exports = {
    shouldUseRefreshHint,
    nextPollDelayMs
};
