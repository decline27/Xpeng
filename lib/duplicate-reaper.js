'use strict';

/**
 * Shared duplicate-reaper core.
 *
 * The same physical car (VIN) can end up linked under several Enode users/clients (legacy
 * identity churn, client rotation). Each stale copy wastes one of the 25-slots-per-client.
 * This module finds those duplicates and frees slots by deleting ONLY the stale copies.
 *
 * Safety — `DELETE /users/{userId}` removes the WHOLE user and ALL their vehicles, so we
 * reason at the USER level:
 *   - For each duplicated VIN we KEEP the most-recently-seen copy (the live one) and mark the
 *     older copies stale.
 *   - A user is disconnected only when EVERY car they own is a stale copy. If a user also owns
 *     a kept/live car, they are SKIPPED (flagged risky) so we never disconnect a live customer.
 *
 * Used by both the CLI sweep (scripts/enode-dedupe.js) and the in-app auto-reap on connect.
 */

function lastSeenMs(vehicle) {
    return vehicle.lastSeen ? new Date(vehicle.lastSeen).getTime() : 0;
}

/**
 * Scan all clients (raw, non-deduplicated) and classify duplicate links.
 * @param {EnodeAPI} api
 * @returns {Promise<{totalRecords:number, dupVins:number, staleCount:number,
 *   safe:Array<{userId:string, clientId:string, vins:string[]}>,
 *   risky:Array<{userId:string, clientId:string, vins:string[]}>}>}
 */
async function analyzeDuplicates(api) {
    const clients = api.clientManager.getAllClients();
    const records = [];
    for (const client of clients) {
        // Raw per-client list — api.getVehicles() dedupes by VIN and would hide the duplicates.
        const vehicles = await api._getVehiclesForClient(client.id);
        for (const v of vehicles) {
            const vin = v.information && v.information.vin;
            if (!vin || !v.userId) {
                continue;
            }
            records.push({
                vin,
                userId: v.userId,
                clientId: v._clientId || client.id,
                vehicleId: v.id,
                lastSeen: v.lastSeen || null,
            });
        }
    }

    const byVin = {};
    for (const r of records) {
        (byVin[r.vin] = byVin[r.vin] || []).push(r);
    }

    // Track kept/live cars per (client, user), NOT per user alone. Enode namespaces users per
    // client and disconnectUser(userId, clientId) deletes only that client's copy, so a user who
    // owns a live car on clientB is unaffected by deleting their stale copy on clientA. Keying by
    // userId alone would wrongly flag every cross-client duplicate as risky and never reap it.
    const staleRecords = [];
    const keptByClientUser = new Set();
    let dupVins = 0;
    for (const recs of Object.values(byVin)) {
        if (recs.length < 2) {
            keptByClientUser.add(`${recs[0].clientId}::${recs[0].userId}`); // single copy → kept/live
            continue;
        }
        dupVins++;
        recs.sort((a, b) => lastSeenMs(b) - lastSeenMs(a)); // newest first
        keptByClientUser.add(`${recs[0].clientId}::${recs[0].userId}`);
        for (const r of recs.slice(1)) {
            staleRecords.push(r);
        }
    }

    const safe = new Map();
    const risky = new Map();
    for (const s of staleRecords) {
        const key = `${s.clientId}::${s.userId}`;
        const bucket = keptByClientUser.has(key) ? risky : safe;
        const entry = bucket.get(key) || { userId: s.userId, clientId: s.clientId, vins: new Set() };
        entry.vins.add(s.vin);
        bucket.set(key, entry);
    }

    const toArray = (m) => [...m.values()].map((e) => ({ userId: e.userId, clientId: e.clientId, vins: [...e.vins] }));
    return {
        totalRecords: records.length,
        dupVins,
        staleCount: staleRecords.length,
        safe: toArray(safe),
        risky: toArray(risky),
    };
}

/**
 * Disconnect a list of {userId, clientId} entries.
 * @returns {Promise<{ok:number, fail:number}>}
 */
async function disconnectUsers(api, users, logger) {
    let ok = 0;
    let fail = 0;
    for (const u of users) {
        try {
            await api.disconnectUser(u.userId, u.clientId);
            ok++;
            if (logger) logger.log(`[reaper] disconnected stale ${u.clientId} / ${u.userId}`);
        } catch (error) {
            fail++;
            if (logger) logger.error(`[reaper] failed ${u.clientId} / ${u.userId}: ${error.message}`);
        }
    }
    return { ok, fail };
}

/**
 * Reap stale duplicate copies of a single VIN. Intended for connect-time cleanup: after a car
 * reconnects, remove its older copies while keeping the freshly-connected one.
 * @param {EnodeAPI} api
 * @param {string} vin
 * @param {{execute?:boolean, logger?:object}} [opts]
 * @returns {Promise<{targets:Array, disconnected:number, failed:number, executed:boolean}>}
 */
async function reapForVin(api, vin, opts = {}) {
    const { execute = false, logger = null } = opts;
    if (!vin) {
        return { targets: [], disconnected: 0, failed: 0, executed: false };
    }
    const analysis = await analyzeDuplicates(api);
    const targets = analysis.safe.filter((u) => u.vins.includes(vin));
    if (!execute || targets.length === 0) {
        if (logger && targets.length > 0) {
            logger.log(`[reaper] (log-only) would disconnect ${targets.length} stale copy(ies) of ${vin}`);
        }
        return { targets, disconnected: 0, failed: 0, executed: false };
    }
    const res = await disconnectUsers(api, targets, logger);
    return { targets, disconnected: res.ok, failed: res.fail, executed: true };
}

/**
 * Reap all safe stale duplicates (CLI sweep).
 * @param {EnodeAPI} api
 * @param {{execute?:boolean, logger?:object}} [opts]
 */
async function reapAll(api, opts = {}) {
    const { execute = false, logger = null } = opts;
    const analysis = await analyzeDuplicates(api);
    if (!execute || analysis.safe.length === 0) {
        return { ...analysis, disconnected: 0, failed: 0, executed: false };
    }
    const res = await disconnectUsers(api, analysis.safe, logger);
    return { ...analysis, disconnected: res.ok, failed: res.fail, executed: true };
}

module.exports = {
    analyzeDuplicates,
    reapForVin,
    reapAll,
    disconnectUsers,
};
