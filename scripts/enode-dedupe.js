#!/usr/bin/env node

/**
 * Enode Duplicate Reaper CLI (admin-only)
 *
 * Thin wrapper around lib/duplicate-reaper.js so the manual sweep and the in-app auto-reap
 * share identical logic. Finds cars (VINs) linked under multiple Enode users/clients and frees
 * wasted slots by deleting ONLY stale copies — keeping the most-recently-seen (live) one and
 * sparing any user who also owns a live car. See lib/duplicate-reaper.js for the safety model.
 *
 * Usage:
 *   node scripts/enode-dedupe.js              # DRY RUN (default) — shows the plan
 *   node scripts/enode-dedupe.js --execute    # actually disconnect the stale users
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

// --- Module mocking: provide a fake 'homey' so the libs load standalone ---
const mockSettings = {};
const mockHomey = {
    log: () => {},        // silence noisy lib logs; this script prints its own report
    error: (...args) => console.error('[ERROR]', ...args),
    warn: (...args) => console.warn('[WARN]', ...args),
    settings: {
        get: (key) => mockSettings[key] || null,
        set: (key, val) => { mockSettings[key] = val; },
    },
    env: {},
};

const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName) {
    if (moduleName === 'homey') return mockHomey;
    return originalRequire.apply(this, arguments);
};
// ---------------------------------------------------------------------------

const EnodeAPI = require('../lib/enode-api');
const DuplicateReaper = require('../lib/duplicate-reaper');

function loadEnv() {
    const envPath = path.join(__dirname, '../env.json');
    if (!fs.existsSync(envPath)) {
        console.error('Error: env.json not found.');
        process.exit(1);
    }
    const env = JSON.parse(fs.readFileSync(envPath, 'utf8'));
    mockHomey.env = env;
    global.Homey = mockHomey;
    return env;
}

async function main() {
    const isExecute = process.argv.includes('--execute');
    console.log('--- Enode Duplicate Reaper ---');
    console.log(isExecute ? 'Mode: EXECUTE (stale users will be disconnected)' : 'Mode: DRY RUN (no changes) — pass --execute to apply');

    loadEnv();
    const api = new EnodeAPI(mockHomey);

    // Shared core: analyze (and optionally disconnect) using the same logic as the in-app reaper.
    const result = await DuplicateReaper.reapAll(api, { execute: isExecute, logger: console });

    console.log(`\nScanned ${result.totalRecords} total linked vehicle records.`);
    console.log(`Duplicated VINs: ${result.dupVins} | stale copies: ${result.staleCount}`);

    console.log('\n--- Plan: stale users to disconnect (safe — own no kept car) ---');
    if (result.safe.length === 0) {
        console.log('  (none)');
    } else {
        for (const e of result.safe) {
            console.log(`  client=${e.clientId.padEnd(10)} user=${e.userId}  vins=[${e.vins.join(', ')}]`);
        }
    }
    if (result.risky.length > 0) {
        console.log('\n--- SKIPPED (risky — user also owns a kept/live car) ---');
        for (const e of result.risky) {
            console.log(`  client=${e.clientId.padEnd(10)} user=${e.userId}  stale-vins=[${e.vins.join(', ')}]`);
        }
    }
    console.log(`\nReclaimable slots (safe): ${result.safe.length}`);

    if (!isExecute) {
        console.log('\nDRY RUN complete. Re-run with --execute to disconnect the safe list above.');
        return;
    }
    console.log(`\nDone. Disconnected ${result.disconnected}, failed ${result.failed}.`);
}

main().catch((err) => { console.error('\nReaper failed:', err); process.exit(1); });
