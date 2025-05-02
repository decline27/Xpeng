const fetch = require('node-fetch');
const Homey = require('homey');
const { URLSearchParams } = require('url');

/**
 * OAuth2 client for Enode API
 * Uses Homey's built-in OAuth2 functionality
 */
class EnodeOAuth2 {
  constructor(options) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;

    // Use a custom redirect URI that will automatically close the browser window
    this.redirectUri = options.redirectUri || 'https://homey.app/oauth/close.html';

    this.homey = options.homey;
    this.logger = options.logger || console;

    // Token storage
    this.token = null;
    this.refreshToken = null;
    this.tokenExpiresAt = null;

    // API endpoints
    this.apiBaseUrl = 'https://enode-api.production.enode.io';
    this.oauthBaseUrl = 'https://oauth.production.enode.io';
    this.authorizationUrl = 'https://link.enode.com';

    // Default scopes
    this.scopes = [
      'vehicle:read:data',
      'vehicle:read:location',
      'vehicle:control:charging'
    ];
  }

  /**
   * Initialize the OAuth2 client with Homey
   *
   * Note: Homey doesn't support registerWebhook, so we don't register a callback.
   * Instead, we rely on the redirect URL to handle the OAuth2 flow.
   * The token is obtained directly from the Enode API using the client credentials.
   */
  init() {
    this.logger.log('Initializing Enode OAuth2 client');
    // No webhook registration needed for this implementation
  }

  /**
   * Generate an authorization URL for the user to connect their XPENG account
   * @param {string} userId - Unique user ID for this session
   * @returns {Promise<string>} The authorization URL
   */
  async generateAuthUrl(userId) {
    try {
      // Get a machine token for API access
      const machineToken = await this.getMachineToken();

      // Generate a link URL
      const response = await fetch(`${this.apiBaseUrl}/users/${userId}/link`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${machineToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vendorType: 'vehicle',
          scopes: this.scopes,
          language: 'en-US',
          redirectUri: this.redirectUri,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to generate link: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      if (!data.linkUrl) {
        throw new Error('Link URL missing from response');
      }

      return data.linkUrl;
    } catch (error) {
      this.logger.error('Error generating auth URL:', error);
      throw error;
    }
  }

  /**
   * Exchange an authorization code for an access token
   * @param {string} code - The authorization code
   * @returns {Promise<Object>} The token response
   */
  async getTokenByCode(code) {
    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'authorization_code');
      params.append('code', code);
      params.append('redirect_uri', this.redirectUri);

      const response = await fetch(`${this.oauthBaseUrl}/oauth2/token`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token exchange failed: ${response.status} ${errorText}`);
      }

      const tokenData = await response.json();
      this.saveToken(tokenData);
      return tokenData;
    } catch (error) {
      this.logger.error('Error exchanging code for token:', error);
      throw error;
    }
  }

  /**
   * Save the token data
   * @param {Object} tokenData - The token data from the OAuth2 server
   */
  saveToken(tokenData) {
    this.token = tokenData.access_token;
    this.refreshToken = tokenData.refresh_token;

    // Calculate token expiration time
    const expiresIn = tokenData.expires_in || 3600;
    this.tokenExpiresAt = Date.now() + (expiresIn * 1000) - 60000; // 1 minute buffer

    this.logger.log('Token saved, expires in:', expiresIn, 'seconds');
  }

  /**
   * Get a valid access token, refreshing if necessary
   * @returns {Promise<string>} The access token
   */
  async getAccessToken() {
    // If token is expired or missing, try to refresh
    if (!this.token || Date.now() >= this.tokenExpiresAt) {
      if (this.refreshToken) {
        await this.refreshAccessToken();
      } else {
        throw new Error('No valid token available and no refresh token to get a new one');
      }
    }

    return this.token;
  }

  /**
   * Refresh the access token using the refresh token
   * @returns {Promise<Object>} The new token data
   */
  async refreshAccessToken() {
    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'refresh_token');
      params.append('refresh_token', this.refreshToken);

      const response = await fetch(`${this.oauthBaseUrl}/oauth2/token`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Token refresh failed: ${response.status} ${errorText}`);
      }

      const tokenData = await response.json();
      this.saveToken(tokenData);
      return tokenData;
    } catch (error) {
      this.logger.error('Error refreshing token:', error);
      // Clear tokens on refresh failure
      this.token = null;
      this.refreshToken = null;
      this.tokenExpiresAt = null;
      throw error;
    }
  }

  /**
   * Get a machine token for API access (client credentials flow)
   * @returns {Promise<string>} The machine token
   */
  async getMachineToken() {
    try {
      const response = await fetch(`${this.oauthBaseUrl}/oauth2/token`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get machine token: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      if (!data.access_token) {
        throw new Error('Access token missing from response');
      }

      return data.access_token;
    } catch (error) {
      this.logger.error('Error getting machine token:', error);
      throw error;
    }
  }

  /**
   * Make an authenticated API request
   * @param {string} endpoint - API endpoint (without base URL)
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} The API response
   */
  async apiRequest(endpoint, options = {}) {
    try {
      const token = await this.getAccessToken();

      const response = await fetch(`${this.apiBaseUrl}${endpoint}`, {
        ...options,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          ...options.headers,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API request failed: ${response.status} ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      this.logger.error(`API request to ${endpoint} failed:`, error);
      throw error;
    }
  }

  /**
   * Get the user's vehicles
   * @returns {Promise<Array>} List of vehicles
   */
  async getVehicles() {
    const response = await this.apiRequest('/vehicles');
    return response.data || [];
  }

  /**
   * Get data for a specific vehicle
   * @param {string} vehicleId - The vehicle ID
   * @returns {Promise<Object>} Vehicle data
   */
  async getVehicleData(vehicleId) {
    return this.apiRequest(`/vehicles/${vehicleId}`);
  }

  /**
   * Start charging a vehicle
   * @param {string} vehicleId - The vehicle ID
   * @returns {Promise<Object>} Command result
   */
  async startCharging(vehicleId) {
    return this.apiRequest(`/vehicles/${vehicleId}/charging/start`, {
      method: 'POST',
    });
  }

  /**
   * Stop charging a vehicle
   * @param {string} vehicleId - The vehicle ID
   * @returns {Promise<Object>} Command result
   */
  async stopCharging(vehicleId) {
    return this.apiRequest(`/vehicles/${vehicleId}/charging/stop`, {
      method: 'POST',
    });
  }

  /**
   * Set the charging limit for a vehicle
   * @param {string} vehicleId - The vehicle ID
   * @param {number} limit - The charging limit (0-100)
   * @returns {Promise<Object>} Command result
   */
  async setChargingLimit(vehicleId, limit) {
    return this.apiRequest(`/vehicles/${vehicleId}/charging/limit`, {
      method: 'POST',
      body: JSON.stringify({ limit }),
    });
  }

  /**
   * Load token data from storage
   * @param {Object} tokenData - The token data to load
   */
  loadToken(tokenData) {
    if (tokenData) {
      this.token = tokenData.token;
      this.refreshToken = tokenData.refreshToken;
      this.tokenExpiresAt = tokenData.expiresAt;

      this.logger.log('Token loaded from storage');
    }
  }

  /**
   * Get the current token data for storage
   * @returns {Object|null} The token data or null if no token
   */
  getTokenData() {
    if (!this.token) return null;

    return {
      token: this.token,
      refreshToken: this.refreshToken,
      expiresAt: this.tokenExpiresAt,
    };
  }
}

module.exports = EnodeOAuth2;
