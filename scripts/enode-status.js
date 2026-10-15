'use strict';

// Read-only production diagnostics. Never emits tokens, credentials, VINs, or user IDs.
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

async function main() {
    const env = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'env.json'), 'utf8'));
    const requested = process.argv[2];
    if (requested && !/^(primary|secondary|[3-9]|[1-9][0-9]+)$/.test(requested)) {
        throw new Error('Choose primary, secondary, or an additional client number (3 or greater).');
    }
    const suffixes = ['', '_SECONDARY', ...Object.keys(env)
        .map(key => /^ENODE_CLIENT_ID_(\d+)$/.exec(key))
        .filter(match => match && Number(match[1]) >= 3)
        .sort((a, b) => Number(a[1]) - Number(b[1]))
        .map(match => `_${match[1]}`)];
    let checked = 0;
    for (const suffix of suffixes) {
        const label = suffix === '' ? 'primary' : suffix === '_SECONDARY' ? 'secondary' : suffix.slice(1);
        if (requested && requested !== label) continue;
        const clientId = env[`ENODE_CLIENT_ID${suffix}`];
        const clientSecret = env[`ENODE_CLIENT_SECRET${suffix}`];
        if (!clientId || !clientSecret) continue;
        checked++;
        try {
            const auth = await fetch('https://oauth.production.enode.io/oauth2/token', {
                method: 'POST',
                headers: {
                    Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: 'grant_type=client_credentials',
                timeout: 15000,
            });
            if (!auth.ok) throw new Error(`Production authentication returned HTTP ${auth.status}`);
            const { access_token: token } = await auth.json();
            if (!token) throw new Error('Production authentication returned no token');
            let after = null;
            let count = 0;
            const cursors = new Set();
            for (let page = 0; page < 20; page++) {
                const response = await fetch(`https://enode-api.production.enode.io/vehicles?pageSize=50${after ? `&after=${encodeURIComponent(after)}` : ''}`, {
                    headers: { Authorization: `Bearer ${token}` }, timeout: 15000,
                });
                if (!response.ok) throw new Error(`Production vehicle read returned HTTP ${response.status}`);
                const data = await response.json();
                if (!Array.isArray(data.data)) throw new Error('Unexpected vehicle response');
                count += data.data.length;
                after = data.pagination?.after;
                if (!after) break;
                if (cursors.has(after)) throw new Error('Vehicle pagination repeated a cursor');
                cursors.add(after);
            }
            if (after) throw new Error('Vehicle pagination exceeded the page limit');
            console.log(JSON.stringify({ client: label, productionReadAccess: true, connectedVehicles: count }));
        } catch (error) {
            process.exitCode = 1;
            // Only emit errors created here, not provider response bodies or request headers.
            const message = /^(Production|Unexpected vehicle|Vehicle pagination)/.test(error.message)
                ? error.message : 'Could not reach Enode';
            console.log(JSON.stringify({ client: label, error: message }));
        }
    }
    if (!checked) throw new Error('No matching credential pair configured in env.json');
}

main().catch(() => {
    console.error('Account check failed. Check env.json and the optional client selector (primary, secondary, or a number from 3).');
    process.exitCode = 1;
});
