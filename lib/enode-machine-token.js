const fetch = require('node-fetch');
const Homey = require('homey');
const { createHash } = require('crypto');

// Token cache for multiple accounts
// Structure: { accountId: { token, expiresAt } }
let tokenCache = {};
const inFlight = new Map(); // accountId -> pending token request
const TTL_BUFFER = 60_000;      // 60s safety margin
const TOKEN_TIMEOUT_MS = 15_000;

/**
 * Fetches a new access token using client credentials flow
 * @param {string} clientId - The client ID
 * @param {string} clientSecret - The client secret
 * @param {string} accountId - The account identifier
 * @returns {Promise<string>} The access token
 */
async function fetchNewToken(clientId, clientSecret, accountId, cacheKey, generation) {
  if (!clientId || !clientSecret) {
    throw new Error('Missing Enode API credentials. This is likely an issue with the app configuration.');
  }

  // Prepare the request body
  const body = 'grant_type=client_credentials';

  // Make the token request
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
  let response;
  try {
    response = await fetch('https://oauth.production.enode.io/oauth2/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`Failed to fetch token for account ${accountId}: status: ${response.status} ${errorText}`);
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error(`Access token missing from response for account ${accountId}`);
  }

  // Cache the token with expiration
  if (generation === tokenCache) {
    tokenCache[cacheKey] = {
      token: data.access_token,
      accountId,
      expiresAt: Date.now() + (data.expires_in * 1000) - TTL_BUFFER,
    };
  }

  return data.access_token;
}

/**
 * Gets a valid machine token for a specific account, fetching a new one if necessary
 * @param {Object} credentials - The credentials object with clientId and clientSecret
 * @param {string} accountId - The account identifier
 * @returns {Promise<string>} The access token
 */
async function getMachineToken(credentials = null, accountId = 'default') {
  // For backward compatibility
  if (!credentials) {
    // Load credentials from env.json or Homey settings (legacy method)
    const clientId = Homey.env.ENODE_CLIENT_ID || (Homey.app && Homey.app.homey ? Homey.app.homey.settings.get('enode_client_id') : null);
    const clientSecret = Homey.env.ENODE_CLIENT_SECRET || (Homey.app && Homey.app.homey ? Homey.app.homey.settings.get('enode_client_secret') : null);
    credentials = { clientId, clientSecret };
  }

  const { clientId, clientSecret } = credentials;
  // A replaced account or rotated secret must never reuse the old account's token.
  const fingerprint = createHash('sha256').update(JSON.stringify([clientId, clientSecret])).digest('hex');
  const cacheKey = `${accountId}:${fingerprint}`;

  // Check if we have a valid cached token
  if (tokenCache[cacheKey] && Date.now() < tokenCache[cacheKey].expiresAt) {
    return tokenCache[cacheKey].token;
  }

  // Share one token request between concurrent callers (e.g. several devices at startup)
  if (!inFlight.has(cacheKey)) {
    const request = fetchNewToken(clientId, clientSecret, accountId, cacheKey, tokenCache)
      .finally(() => {
        if (inFlight.get(cacheKey) === request) inFlight.delete(cacheKey);
      });
    inFlight.set(cacheKey, request);
  }
  return inFlight.get(cacheKey);
}

/**
 * Clears the token cache for a specific account or all accounts
 * @param {string} accountId - The account identifier (optional)
 */
function clearTokenCache(accountId = null) {
  if (accountId) {
    // Clear specific account token
    tokenCache = Object.fromEntries(Object.entries(tokenCache).filter(([, entry]) => entry.accountId !== accountId));
    for (const key of inFlight.keys()) {
      if (key.startsWith(`${accountId}:`)) inFlight.delete(key);
    }
  } else {
    // Clear all tokens
    tokenCache = {};
    inFlight.clear();
  }
}

module.exports = {
  getMachineToken,
  clearTokenCache
};
