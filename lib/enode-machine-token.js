const fetch = require('node-fetch');
const Homey = require('homey');

let cache = null;               // { token, expiresAt }
const TTL_BUFFER = 60_000;      // 60s safety margin

/**
 * Fetches a new access token using client credentials flow
 * @returns {Promise<string>} The access token
 */
async function fetchNewToken() {
  // Load credentials from env.json or Homey settings
  const clientId = Homey.env.ENODE_CLIENT_ID || Homey.app.homey.settings.get('enode_client_id');
  const clientSecret = Homey.env.ENODE_CLIENT_SECRET || Homey.app.homey.settings.get('enode_client_secret');

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
    throw new Error(`Failed to fetch token: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error('Access token missing from response');
  }

  // Cache the token with expiration
  cache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000) - TTL_BUFFER,
  };

  return cache.token;
}

/**
 * Gets a valid machine token, fetching a new one if necessary
 * @returns {Promise<string>} The access token
 */
async function getMachineToken() {
  if (!cache || Date.now() >= cache.expiresAt) {
    return fetchNewToken();
  }
  return cache.token;
}

/**
 * Clears the token cache
 */
function clearTokenCache() {
  cache = null;
}

module.exports = {
  getMachineToken,
  clearTokenCache
};
