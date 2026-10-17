'use strict';

/**
 * Find Enode users that own no vehicle (admin cleanup).
 *
 * A user can be left empty when a car is unlinked but the user is kept, or when someone opens
 * a link and never finishes. Such users may still take one of a client's limited seats.
 *
 * Safety:
 *   - Users are checked per client: Enode namespaces users per client, so an empty user on
 *     clientA says nothing about the same id on clientB, and deleting it there leaves clientB alone.
 *   - Users created recently are skipped: someone who is linking right now briefly has an
 *     empty user.
 *   - Each candidate is re-checked with GET /users/{id}; only a user with no linked vendors is
 *     reported. Any error means "not empty" (never report what can't be confirmed).
 */

const USER_PAGE_SIZE = 50;
const MAX_USER_PAGES = 50;
const DEFAULT_MIN_AGE_HOURS = 24;

/**
 * List every user on one client, following Enode's cursor pagination.
 * @param {EnodeAPI} api
 * @param {string} clientId
 * @returns {Promise<Array<{id:string, createdAt:string}>>}
 */
async function listUsers(api, clientId) {
    const token = await api.getAccessToken(null, clientId);
    const users = [];
    let after = null;
    for (let page = 0; page < MAX_USER_PAGES; page++) {
        const query = `pageSize=${USER_PAGE_SIZE}${after ? `&after=${encodeURIComponent(after)}` : ''}`;
        const response = await api.makeRequest(`${api.apiBaseUrl}/users?${query}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        const body = await response.json();
        if (!Array.isArray(body.data)) {
            throw new Error(`Invalid response from Enode /users for client ${clientId}`);
        }
        users.push(...body.data);
        after = body.pagination && body.pagination.after;
        if (!after) return users;
    }
    throw new Error(`Enode user pagination exceeded the page limit for client ${clientId}`);
}

/**
 * Confirm a user has no linked vendors. Any error counts as "not empty".
 * @param {EnodeAPI} api
 * @param {string} clientId
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isConfirmedEmpty(api, clientId, userId) {
    try {
        const token = await api.getAccessToken(null, clientId);
        const response = await api.makeRequest(`${api.apiBaseUrl}/users/${encodeURIComponent(userId)}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        const user = await response.json();
        return Array.isArray(user.linkedVendors) && user.linkedVendors.length === 0;
    } catch (error) {
        return false;
    }
}

/**
 * Find users that own no vehicle, per client.
 * @param {EnodeAPI} api
 * @param {{minAgeHours?:number, now?:number}} [opts]
 * @returns {Promise<{empty:Array<{userId:string, clientId:string, createdAt:string}>,
 *   skippedRecent:number, byClient:Object}>}
 */
async function findEmptyUsers(api, opts = {}) {
    const { minAgeHours = DEFAULT_MIN_AGE_HOURS, now = Date.now() } = opts;
    const minAgeMs = minAgeHours * 60 * 60 * 1000;
    const empty = [];
    const byClient = {};
    let skippedRecent = 0;

    for (const client of api.clientManager.getAllClients()) {
        if (!client.enodeClientId || !client.enodeClientSecret) continue;

        // Fresh raw list: the request cache could hide a car linked a moment ago
        api.requestCache.clear(`vehicles_${client.id}`);
        const vehicles = await api._getVehiclesForClient(client.id);
        const owners = new Set(vehicles.map(vehicle => vehicle.userId).filter(Boolean));
        const users = await listUsers(api, client.id);

        let clientEmpty = 0;
        for (const user of users) {
            if (owners.has(user.id)) continue;
            const created = Date.parse(user.createdAt);
            if (!Number.isFinite(created) || now - created < minAgeMs) {
                skippedRecent++;
                continue;
            }
            if (await isConfirmedEmpty(api, client.id, user.id)) {
                empty.push({ userId: user.id, clientId: client.id, createdAt: user.createdAt });
                clientEmpty++;
            }
        }
        byClient[client.id] = { users: users.length, withCars: owners.size, empty: clientEmpty };
    }

    return { empty, skippedRecent, byClient };
}

module.exports = {
    findEmptyUsers,
    listUsers,
    DEFAULT_MIN_AGE_HOURS,
};
