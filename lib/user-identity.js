'use strict';

/**
 * Stable Enode user-identity helper.
 *
 * The original code built the Enode user ID as `homey-${this.homey.id}-${installationId}`,
 * but `homey.id` does not exist in the SDK, so it always collapsed to the literal `'homey'`
 * and identity rested entirely on a random `installation_id`. That id is wiped on app
 * reinstall / Homey restore, so a returning user looked brand new and their car was linked
 * again as a duplicate.
 *
 * This helper derives the user ID from the real, reinstall-stable Homey Cloud ID
 * (`homey.cloud.getHomeyId()`), caching it in settings. It also exposes the legacy ID so
 * filtering can dual-match during migration and never hide an already-linked car.
 */

const STABLE_ID_KEY = 'stable_homey_id';
const LEGACY_INSTALL_KEY = 'installation_id';

/**
 * Resolve the stable Enode user ID for this Homey, e.g. `homey-<homeyCloudId>`.
 * The resolved id is cached in settings so it stays consistent (and survives reinstall,
 * because the Homey Cloud ID does).
 * @param {object} homey - Homey instance (App/Driver `this.homey`, or the object passed to EnodeAPI)
 * @returns {Promise<string>}
 */
async function resolveUserId(homey) {
    const cached = homey.settings.get(STABLE_ID_KEY);
    if (cached) {
        return `homey-${cached}`;
    }

    let stableId = null;
    try {
        if (homey.cloud && typeof homey.cloud.getHomeyId === 'function') {
            stableId = await homey.cloud.getHomeyId();
        }
    } catch (error) {
        // Cloud id unavailable (offline / unsupported) — fall through to a consistent fallback.
    }

    if (!stableId) {
        // Keep a *consistent* id even without the cloud id: reuse the existing installation id
        // if present, otherwise mint one and persist it so it never churns between calls.
        stableId = homey.settings.get(LEGACY_INSTALL_KEY)
            || `gen-${Date.now().toString(36)}${Math.random().toString(36).substring(2, 8)}`;
    }

    homey.settings.set(STABLE_ID_KEY, stableId);
    return `homey-${stableId}`;
}

/**
 * The legacy (pre-fix) user ID, `homey-<homey.id|'homey'>-<installationId>`, or null if no
 * installation id was ever stored. Used only for migration dual-matching.
 * @param {object} homey
 * @returns {string|null}
 */
function getLegacyUserId(homey) {
    const installationId = homey.settings.get(LEGACY_INSTALL_KEY);
    if (!installationId) {
        return null;
    }
    const homeyId = homey.id || 'homey';
    return `homey-${homeyId}-${installationId}`;
}

/**
 * All user IDs that should be treated as "this Homey" while filtering vehicles: the new stable
 * id plus the legacy id (if any). Lets an existing user still see their car mid-migration.
 * @param {object} homey
 * @returns {Promise<string[]>}
 */
async function getUserIdCandidates(homey) {
    const candidates = new Set();
    candidates.add(await resolveUserId(homey));
    const legacy = getLegacyUserId(homey);
    if (legacy) {
        candidates.add(legacy);
    }
    return [...candidates];
}

module.exports = {
    resolveUserId,
    getLegacyUserId,
    getUserIdCandidates,
    STABLE_ID_KEY,
    LEGACY_INSTALL_KEY,
};
