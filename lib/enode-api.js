const fetch = require('node-fetch');
const Homey = require('homey');
const { RateLimiter, RequestCache, retryWithBackoff } = require('./utils');
const { getMachineToken, clearTokenCache } = require('./enode-machine-token');

// API URL configuration for easier environment switching
const API_CONFIG = {
  production: {
    oauthBaseUrl: 'https://oauth.production.enode.io',
    apiBaseUrl: 'https://enode-api.production.enode.io'
  },
  staging: {
    oauthBaseUrl: 'https://oauth.staging.enode.io',
    apiBaseUrl: 'https://enode-api.staging.enode.io'
  },
  development: {
    oauthBaseUrl: 'https://oauth.dev.enode.io',
    apiBaseUrl: 'https://enode-api.dev.enode.io'
  }
};

class EnodeAPI {
  constructor(api, environment = 'production') {
    this.api = api;
    this.rateLimiter = new RateLimiter(10, 1000); // 10 requests per second
    this.requestCache = new RequestCache(1000, 60000); // Cache 1000 items, 1 minute TTL

    // Set up base URLs based on environment
    const envConfig = API_CONFIG[environment] || API_CONFIG.production;
    this.oauthBaseUrl = envConfig.oauthBaseUrl;
    this.apiBaseUrl = envConfig.apiBaseUrl;
  }

  /**
   * Make an API request with proper throttling, timeouts, and retries
   * @param {string} url - The URL to request
   * @param {Object} options - Fetch options
   * @param {number} [timeoutMs=30000] - Request timeout in milliseconds
   * @returns {Promise<Response>} - Fetch response object
   */
  async makeRequest(url, options, timeoutMs = 30000) {
    // Apply rate limiting
    await this.rateLimiter.throttle();

    return retryWithBackoff(async () => {
      // Set up abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      try {
        // Add signal to request options
        const requestOptions = {
          ...options,
          signal: controller.signal
        };

        // Execute the request
        const response = await fetch(url, requestOptions);

        // Handle error responses
        if (!response.ok) {
          let errorBody = 'No error body';
          try {
            errorBody = await response.text();
          } catch (e) {
            // Ignore text parsing errors
          }

          throw new Error(`HTTP error! status: ${response.status}, url: ${url}, body: ${errorBody}`);
        }

        return response;
      } finally {
        // Always clear the timeout
        clearTimeout(timeoutId);
      }
    });
  }

  /**
   * Get an access token for API requests
   * @returns {Promise<string>} The access token
   */
  async getAccessToken() {
    try {
      return await getMachineToken();
    } catch (error) {
      this.api.error('Error fetching access token:', error);
      throw new Error(`Error fetching access token: ${error.message}`);
    }
  }

  /**
   * Generate a vehicle link URL for user authentication
   * @param {string} userId - Unique user ID for this session
   * @returns {Promise<string>} The link URL
   */
  async generateVehicleLink(userId) {
    try {
      const accessToken = await this.getAccessToken();
      const response = await this.makeRequest(
        `${this.apiBaseUrl}/users/${userId}/link`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            vendorType: 'vehicle',
            scopes: [
              'vehicle:read:data',
              'vehicle:read:location',
              'vehicle:control:charging',
            ],
            language: 'en-US',
            redirectUri: `https://callback.athom.com/oauth2/callback`,
          }),
        }
      );

      const data = await response.json();
      if (!data.linkUrl) {
        throw new Error('Link URL missing from response');
      }
      return data.linkUrl;
    } catch (error) {
      this.api.error('Failed to generate vehicle link:', error);
      throw new Error(`Failed to generate vehicle link: ${error.message}`);
    }
  }

  /**
   * Get all vehicles for the authenticated user
   * @returns {Promise<Array>} List of vehicles
   */
  async getVehicles() {
    try {
      const cacheKey = 'vehicles';
      const cachedData = this.requestCache.get(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      const accessToken = await this.getAccessToken();
      const response = await this.makeRequest(
        `${this.apiBaseUrl}/vehicles`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
        }
      );

      const responseData = await response.json();

      if (!responseData.data || !Array.isArray(responseData.data)) {
        this.api.error('Invalid response format:', responseData);
        throw new Error('Invalid response format from Enode API');
      }

      // Cache the response with 1-minute TTL
      this.requestCache.set(cacheKey, responseData.data, 60000);

      return responseData.data;
    } catch (error) {
      this.api.error('Failed to fetch vehicles:', error);
      throw new Error(`Failed to fetch vehicles: ${error.message}`);
    }
  }

  /**
   * Get data for a specific vehicle
   * @param {string} vehicleId - The vehicle ID
   * @returns {Promise<Object>} Vehicle data
   */
  async getVehicleData(vehicleId) {
    try {
      const cacheKey = `vehicle_${vehicleId}`;
      const cachedData = this.requestCache.get(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      const accessToken = await this.getAccessToken();
      const response = await this.makeRequest(
        `${this.apiBaseUrl}/vehicles/${vehicleId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
        }
      );

      const responseData = await response.json();

      // For individual vehicle data, the response is not wrapped in a data field
      const data = responseData.data || responseData;

      if (!data || !data.id) {
        this.api.error('Invalid vehicle data format:', responseData);
        throw new Error('Invalid vehicle data format from Enode API');
      }

      this.requestCache.set(cacheKey, data);
      return data;
    } catch (error) {
      this.api.error(`Failed to get vehicle data for ${vehicleId}:`, error.message);
      throw new Error(`Failed to get vehicle data: ${error.message}`);
    }
  }

  /**
   * Get the status of a vehicle action
   * @param {string} actionId - The action ID
   * @returns {Promise<Object>} Action status
   */
  async getActionStatus(actionId) {
    try {
      const accessToken = await this.getAccessToken();
      const response = await this.makeRequest(
        `${this.apiBaseUrl}/vehicles/actions/${actionId}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }
      );

      const responseData = await response.json();
      const data = responseData.data || responseData;

      this.api.log(`Action status for ${actionId}:`, data);
      return data;
    } catch (error) {
      this.api.error(`Failed to get action status for ${actionId}:`, error.message);
      throw new Error(`Failed to get action status: ${error.message}`);
    }
  }

  /**
   * Wait for an action to complete
   * @param {string} actionId - The action ID
   * @param {number} pollIntervalMs - Polling interval in milliseconds
   * @param {number} maxAttempts - Maximum number of polling attempts
   * @returns {Promise<Object>} Final action status
   */
  async waitForAction(actionId, pollIntervalMs = 2000, maxAttempts = 30) {
    let attempts = 0;
    const maxWaitTimeMs = maxAttempts * pollIntervalMs;

    while (attempts < maxAttempts) {
      attempts++;
      const status = await this.getActionStatus(actionId);

      switch (status.state) {
        case 'CONFIRMED':
          return status;
        case 'FAILED':
          throw new Error(`Action failed: ${status.failureReason || 'Unknown reason'}`);
        case 'CANCELLED':
          throw new Error('Action was cancelled');
        case 'PENDING':
          // Action is still in progress, wait before checking again
          if (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
          }
          break;
        default:
          throw new Error(`Unknown action state: ${status.state}`);
      }
    }

    throw new Error(`Action timed out after ${maxWaitTimeMs/1000} seconds`);
  }

  /**
   * Refresh vehicle data from the vehicle
   * @param {string} vehicleId - The vehicle ID
   * @param {number} waitMs - Time to wait after refresh before fetching data
   * @returns {Promise<Object>} Updated vehicle data
   */
  async refreshVehicleData(vehicleId, waitMs = 2000) {
    try {
      // Check when we last used refresh-hint for this vehicle
      const lastRefreshKey = `last_refresh_${vehicleId}`;
      const refreshCountKey = `refresh_count_${vehicleId}`;
      const hourlyResetKey = `refresh_reset_${vehicleId}`;
      const lastRefresh = this.requestCache.get(lastRefreshKey);
      const refreshCount = this.requestCache.get(refreshCountKey) || 0;
      const lastHourlyReset = this.requestCache.get(hourlyResetKey) || 0;
      const now = Date.now();

      // Reset counter if an hour has passed
      if (now - lastHourlyReset > 60 * 60 * 1000) {
        this.requestCache.set(refreshCountKey, 0);
        this.requestCache.set(hourlyResetKey, now);
      }

      // Only allow refresh-hint every 5 minutes to protect battery
      const minRefreshInterval = 5 * 60 * 1000; // 5 minutes in ms

      // Check both rate limit (9 per hour) and minimum interval
      if ((refreshCount >= 9) || (lastRefresh && (now - lastRefresh) < minRefreshInterval)) {
        const reason = refreshCount >= 9 ? 'hourly rate limit reached' : 'minimum interval not met';
        this.api.log(`Skipping refresh-hint for vehicle ${vehicleId}, ${reason}. Count: ${refreshCount}, Last refresh: ${Math.round((now - lastRefresh)/1000)}s ago`);
        // Just get cached data
        return await this.getVehicleData(vehicleId);
      }

      const accessToken = await this.getAccessToken();
      try {
        await this.makeRequest(
          `${this.apiBaseUrl}/vehicles/${vehicleId}/refresh-hint`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            }
          }
        );
        this.api.log(`Requested data refresh for vehicle ${vehicleId}`);

        // Update counters only on successful refresh
        this.requestCache.set(lastRefreshKey, now);
        this.requestCache.set(refreshCountKey, refreshCount + 1);

        // Wait for the refresh if requested
        if (waitMs > 0) {
          await new Promise(resolve => setTimeout(resolve, waitMs));
        }

        // Clear our cache to force fresh data fetch
        this.requestCache.clear(`vehicle_${vehicleId}`);

        // Get fresh data
        const freshData = await this.getVehicleData(vehicleId);
        return freshData;
      } catch (error) {
        if (error.status === 429) {
          this.api.log(`Rate limit hit for vehicle ${vehicleId}, using cached data`);
          // Force counter to limit to prevent more attempts this hour
          this.requestCache.set(refreshCountKey, 9);
          return await this.getVehicleData(vehicleId);
        }
        throw error;
      }
    } catch (error) {
      // Non-blocking error, just log it
      this.api.error(`Failed to refresh vehicle data: ${error.message}`);
      return null;
    }
  }

  /**
   * Common method to handle charging operations
   * @param {string} vehicleId - The vehicle ID
   * @param {string} action - The charging action (START or STOP)
   * @returns {Promise<Object>} Action result
   */
  async controlCharging(vehicleId, action) {
    if (action !== 'START' && action !== 'STOP') {
      throw new Error(`Invalid charging action: ${action}`);
    }

    try {
      // Verify vehicle exists and get current state in one operation
      let vehicleData;
      try {
        vehicleData = await this.getVehicleData(vehicleId);
        if (!vehicleData) {
          throw new Error('Vehicle data not available');
        }
      } catch (dataError) {
        // Attempt to verify vehicle exists
        const vehicles = await this.getVehicles();
        const vehicle = vehicles.find(v => v.id === vehicleId);

        if (!vehicle) {
          this.api.error(`Vehicle ${vehicleId} not found in user's account. Available vehicles:`,
            vehicles.map(v => ({ id: v.id, name: v.name }))
          );
          throw new Error('Vehicle not found in user\'s account');
        }

        // Try refresh as last resort
        vehicleData = await this.refreshVehicleData(vehicleId);
        if (!vehicleData) {
          throw new Error('Vehicle data unavailable after refresh attempt');
        }
      }

      // Validate vehicle state for the requested charging action
      if (!vehicleData.chargeState?.isPluggedIn) {
        this.api.error(`Vehicle ${vehicleId} not plugged in. Charge state:`, vehicleData.chargeState);
        throw new Error('Vehicle is not plugged in');
      }

      if (action === 'START' && vehicleData.chargeState?.batteryLevel >= 100) {
        throw new Error('Battery is already full');
      }

      if (action === 'STOP' && !vehicleData.chargeState?.isCharging) {
        this.api.log(`Vehicle ${vehicleId} is not currently charging`);
        // Return success since we're already in the desired state
        return { state: 'CONFIRMED', message: 'Vehicle is already not charging' };
      }

      // Get token and make the charging request
      const accessToken = await this.getAccessToken();

      // Log the API request details
      this.api.log(`Sending charging ${action.toLowerCase()} request:`, {
        vehicleId,
        endpoint: `/vehicles/${vehicleId}/charging`,
        method: 'POST',
        action
      });

      const response = await this.makeRequest(
        `${this.apiBaseUrl}/vehicles/${vehicleId}/charging`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({ action })
        }
      );

      const responseData = await response.json();
      const data = responseData.data || responseData;

      // Invalidate vehicle data cache after state change
      this.requestCache.clear(`vehicle_${vehicleId}`);

      // Log successful charge command
      this.api.log(`Successfully sent ${action.toLowerCase()} charging command for vehicle ${vehicleId}:`, data);

      // Wait for the action to complete
      const finalStatus = await this.waitForAction(data.id);
      this.api.log(`Charging action completed for vehicle ${vehicleId}:`, finalStatus);

      return finalStatus;
    } catch (error) {
      // Log the detailed error
      this.api.error(`Failed to ${action.toLowerCase()} charging for vehicle ${vehicleId}:`, error.message);
      throw new Error(`Failed to ${action.toLowerCase()} charging: ${error.message}`);
    }
  }

  /**
   * Start charging a vehicle
   * @param {string} vehicleId - The vehicle ID
   * @returns {Promise<Object>} Action result
   */
  async startCharging(vehicleId) {
    return this.controlCharging(vehicleId, 'START');
  }

  /**
   * Stop charging a vehicle
   * @param {string} vehicleId - The vehicle ID
   * @returns {Promise<Object>} Action result
   */
  async stopCharging(vehicleId) {
    return this.controlCharging(vehicleId, 'STOP');
  }
}

module.exports = EnodeAPI;
