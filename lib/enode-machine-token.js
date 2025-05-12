const fetch = require('node-fetch');
const Homey = require('homey');

// Token cache for multiple accounts
// Structure: { accountId: { token, expiresAt } }
let tokenCache = {};
const TTL_BUFFER = 60_000;      // 60s safety margin

/**
 * Fetches a new access token using client credentials flow
 * @param {string} clientId - The client ID
 * @param {string} clientSecret - The client secret
 * @param {string} accountId - The account identifier
 * @returns {Promise<string>} The access token
 */
async function fetchNewToken(clientId, clientSecret, accountId = 'default') {
  if (!clientId || !clientSecret) {
    throw new Error('Missing Enode API credentials. This is likely an issue with the app configuration.');
  }

  // Prepare the request body
  const body = 'grant_type=client_credentials';

  // Make the token request
  const response = await fetch('https://oauth.production.enode.io/oauth2/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch token for account ${accountId}: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error(`Access token missing from response for account ${accountId}`);
  }

  // Cache the token with expiration
  tokenCache[accountId] = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000) - TTL_BUFFER,
  };

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

  // Check if we have a valid cached token
  if (!tokenCache[accountId] || Date.now() >= tokenCache[accountId].expiresAt) {
    return fetchNewToken(clientId, clientSecret, accountId);
  }

  return tokenCache[accountId].token;
}

/**
 * Clears the token cache for a specific account or all accounts
 * @param {string} accountId - The account identifier (optional)
 */
function clearTokenCache(accountId = null) {
  if (accountId) {
    // Clear specific account token
    if (tokenCache[accountId]) {
      delete tokenCache[accountId];
    }
  } else {
    // Clear all tokens
    tokenCache = {};
  }
}

module.exports = {
  getMachineToken,
  clearTokenCache
};
