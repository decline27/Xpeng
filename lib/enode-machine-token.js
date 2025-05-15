const fetch = require('node-fetch');
const Homey = require('homey');

// Token cache for multiple clients
// Structure: { clientIdentifier: { token, expiresAt } }
let tokenCache = {};
const TTL_BUFFER = 60_000;      // 60s safety margin

/**
 * Fetches a new access token using client credentials flow
 * @param {string} clientId - The client ID
 * @param {string} clientSecret - The client secret
 * @param {string} clientIdentifier - The client identifier for caching
 * @returns {Promise<string>} The access token
 */
async function fetchNewToken(clientId, clientSecret, clientIdentifier = 'default') {
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
    throw new Error(`Failed to fetch token for client ${clientIdentifier}: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error(`Access token missing from response for client ${clientIdentifier}`);
  }

  // Cache the token with expiration
  tokenCache[clientIdentifier] = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000) - TTL_BUFFER,
  };

  return data.access_token;
}

/**
 * Gets a valid machine token for a specific client, fetching a new one if necessary
 * @param {Object} credentials - The credentials object with clientId and clientSecret
 * @param {string} clientIdentifier - The client identifier for caching
 * @returns {Promise<string>} The access token
 */
async function getMachineToken(credentials = null, clientIdentifier = 'default') {
  // For backward compatibility
  if (!credentials) {
    // Load credentials from env.json or Homey settings (legacy method)
    const clientId = Homey.env.ENODE_CLIENT_ID || (Homey.app && Homey.app.homey ? Homey.app.homey.settings.get('enode_client_id') : null);
    const clientSecret = Homey.env.ENODE_CLIENT_SECRET || (Homey.app && Homey.app.homey ? Homey.app.homey.settings.get('enode_client_secret') : null);
    credentials = { clientId, clientSecret };
  }

  const { clientId, clientSecret } = credentials;

  // Check if we have a valid cached token
  if (!tokenCache[clientIdentifier] || Date.now() >= tokenCache[clientIdentifier].expiresAt) {
    return fetchNewToken(clientId, clientSecret, clientIdentifier);
  }

  return tokenCache[clientIdentifier].token;
}

/**
 * Clears the token cache for a specific client or all clients
 * @param {string} clientIdentifier - The client identifier (optional)
 */
function clearTokenCache(clientIdentifier = null) {
  if (clientIdentifier) {
    // Clear specific client token
    if (tokenCache[clientIdentifier]) {
      delete tokenCache[clientIdentifier];
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
