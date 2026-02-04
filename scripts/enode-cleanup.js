#!/usr/bin/env node

/**
 * Enode Connection Cleanup Script
 * 
 * This script identifies and allows cleaning up inactive Enode car connections.
 * 
 * Usage:
 * node scripts/enode-cleanup.js [--dry-run] [--disconnect-inactive] [--disconnect-orphaned]
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

// --- Module Mocking ---
// Mock 'homey' module before requiring any libs that depend on it
const mockSettings = {};
const mockHomey = {
    log: (...args) => console.log('[XPENG]', ...args),
    error: (...args) => console.error('[XPENG ERROR]', ...args),
    warn: (...args) => console.warn('[XPENG WARN]', ...args),
    settings: {
        get: (key) => mockSettings[key] || null,
        set: (key, val) => {
            mockSettings[key] = val;
            // console.log(`[MOCK SETTING] ${key} = ${JSON.stringify(val)}`);
        }
    },
    // Mock Homey app environment
    env: {}
};

const originalRequire = Module.prototype.require;
Module.prototype.require = function (moduleName) {
    if (moduleName === 'homey') {
        return mockHomey;
    }
    return originalRequire.apply(this, arguments);
};
// ----------------------

const EnodeAPI = require('../lib/enode-api');
const AccountCleanup = require('../lib/account-cleanup');

// Load credentials from env.json
function loadCredentials() {
    const envPath = path.join(__dirname, '../env.json');
    if (!fs.existsSync(envPath)) {
        console.error('Error: env.json not found. Please create it from env.sample.json.');
        process.exit(1);
    }

    try {
        const env = JSON.parse(fs.readFileSync(envPath, 'utf8'));
        // Inject into mockHomey for libs to use
        mockHomey.env = env;
        // Also set global.Homey for backward compatibility if needed
        global.Homey = mockHomey;
        return env;
    } catch (error) {
        console.error('Error parsing env.json:', error.message);
        process.exit(1);
    }
}

async function runCleanup() {
    console.log('--- Enode Connection Cleanup ---');
    const env = loadCredentials();

    const args = process.argv.slice(2);
    const isDryRun = args.includes('--dry-run') || args.length === 0;
    const disconnectInactive = args.includes('--disconnect-inactive');
    const disconnectOrphaned = args.includes('--disconnect-orphaned');

    if (isDryRun) {
        console.log('Mode: DRY RUN (no changes will be made)');
        console.log('To execute changes, use: --disconnect-inactive and/or --disconnect-orphaned');
    }

    // Initialize API
    const api = new EnodeAPI(mockHomey);
    const cleanup = new AccountCleanup(api);

    try {
        const report = await cleanup.generateCleanupReport();

        console.log('\n--- Summary ---');
        console.log(`Total Enode Vehicles: ${report.totalEnodeVehicles}`);
        console.log(`Active Homey Devices: ${report.activeHomeyDevices}`);
        console.log(`Orphaned Connections: ${report.orphanedConnections.length}`);
        console.log(`Inactive Connections: ${report.inactiveConnections.length}`);
        console.log(`Active Connections:   ${report.activeConnections.length}`);

        console.log('\n--- Per-Client Breakdown ---');
        Object.entries(report.byClient).forEach(([clientId, stats]) => {
            console.log(`Client: ${clientId.padEnd(12)} | Total: ${stats.total.toString().padStart(2)} | Active: ${stats.active.toString().padStart(2)} | Inactive: ${stats.inactive.toString().padStart(2)} | Orphaned: ${stats.orphaned.toString().padStart(2)}`);
        });

        if (report.inactiveConnections.length > 0) {
            console.log('\n--- Inactive Connections (>30 days since last seen) ---');
            report.inactiveConnections.forEach(v => {
                console.log(`- ${v.brand} ${v.model} (ID: ${v.id}, User: ${v.userId}) - Last seen: ${v.lastSeen} (${v.daysSinceSeen} days ago)`);
            });
        }

        if (report.orphanedConnections.length > 0) {
            console.log('\n--- Orphaned Connections (Not in Homey but recently seen) ---');
            report.orphanedConnections.forEach(v => {
                console.log(`- ${v.brand} ${v.model} (ID: ${v.id}, User: ${v.userId}) - Last seen: ${v.lastSeen}`);
            });
        }

        if (!isDryRun) {
            if (disconnectOrphaned) {
                console.warn('\n!!! WARNING !!!');
                console.warn('The "Orphaned" check is unreliable in standalone mode because it cannot see your Homey Pro devices.');
                console.warn('This WILL likely disconnect active cars that are currently working in your Homey app.');

                if (!args.includes('--force-orphans')) {
                    console.error('\nERROR: Disconnecting orphaned users is disabled for safety.');
                    console.error('To proceed anyway, add the flag: --force-orphans');
                    process.exit(1);
                }
            }

            const toDisconnect = [];
            if (disconnectInactive) toDisconnect.push(...report.inactiveConnections);
            if (disconnectOrphaned) toDisconnect.push(...report.orphanedConnections);

            if (toDisconnect.length > 0) {
                console.log(`\nDisconnecting ${toDisconnect.length} users...`);
                const results = await cleanup.bulkDisconnect(toDisconnect);
                console.log(`Successfully disconnected: ${results.successful.length}`);
                if (results.failed.length > 0) {
                    console.log(`Failed to disconnect: ${results.failed.length}`);
                    results.failed.forEach(f => console.log(` - User ${f.userId}: ${f.error}`));
                }
            } else {
                console.log('\nNo users selected for disconnection.');
            }
        }

    } catch (error) {
        console.error('\nCleanup failed:', error.message);
    }
}

runCleanup();
