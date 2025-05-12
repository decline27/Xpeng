const fetch = require('node-fetch');
const Homey = require('homey');
const { RateLimiter, RequestCache, retryWithBackoff } = require('./utils');
const { getMachineToken, clearTokenCache } = require('./enode-machine-token');
const AccountManager = require('./account-manager');

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

    // Initialize account manager
    this.accountManager = new AccountManager(api);

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
   * @param {string} vehicleId - Optional vehicle ID to determine which account to use
   * @param {string} accountId - Optional explicit account ID to use
   * @returns {Promise<string>} The access token
   */
  async getAccessToken(vehicleId = null, accountId = null) {
    try {
      // Determine which account to use
      let credentials;

      if (accountId) {
        // If account ID is explicitly provided, use it
        credentials = this.accountManager.getCredentials(accountId);
      } else if (vehicleId) {
        // If vehicle ID is provided, get the account associated with it
        credentials = this.accountManager.getVehicleCredentials(vehicleId);
      } else {
        // Otherwise use the default account
        credentials = this.accountManager.getCredentials();
      }

      // Get token using the appropriate credentials
      return await getMachineToken(credentials, credentials.accountId);
    } catch (error) {
      this.api.error('Error fetching access token:', error);
      throw new Error(`Error fetching access token: ${error.message}`);
    }
  }

  /**
   * Generate a vehicle link URL for user authentication
   * @param {string} userId - Unique user ID for this session
   * @param {string} accountId - Optional account ID to use for link generation
   * @returns {Promise<string>} The link URL
   */
  async generateVehicleLink(userId, accountId = null) {
    try {
      // If no account ID is specified, use the default account for new vehicles
      if (!accountId) {
        accountId = this.accountManager.getDefaultAccount();
      }

      this.api.log(`Generating vehicle link using account: ${accountId}`);

      // Get token for the specified account
      const accessToken = await this.getAccessToken(null, accountId);

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
   * @param {string} accountId - Optional account ID to use
   * @param {boolean} getAllAccounts - Whether to get vehicles from all accounts
   * @returns {Promise<Array>} List of vehicles
   */
  async getVehicles(accountId = null, getAllAccounts = true) {
    try {
      // If getAllAccounts is true, we'll fetch vehicles from both accounts and merge them
      if (getAllAccounts) {
        const accountStatus = this.accountManager.checkAccountsStatus();
        let allVehicles = [];

        // Get vehicles from primary account if configured
        if (accountStatus.primaryConfigured) {
          try {
            const primaryVehicles = await this._getVehiclesForAccount(this.accountManager.ACCOUNT_1);

            // Tag vehicles with account info for later reference
            primaryVehicles.forEach(vehicle => {
              if (vehicle.information && vehicle.information.vin) {
                this.accountManager.setVehicleAccount(vehicle.information.vin, this.accountManager.ACCOUNT_1);
              }
            });

            allVehicles = [...allVehicles, ...primaryVehicles];
          } catch (error) {
            this.api.error('Error fetching vehicles from primary account:', error);
          }
        }

        // Get vehicles from secondary account if configured
        if (accountStatus.secondaryConfigured) {
          try {
            const secondaryVehicles = await this._getVehiclesForAccount(this.accountManager.ACCOUNT_2);

            // Tag vehicles with account info for later reference
            secondaryVehicles.forEach(vehicle => {
              if (vehicle.information && vehicle.information.vin) {
                this.accountManager.setVehicleAccount(vehicle.information.vin, this.accountManager.ACCOUNT_2);
              }
            });

            allVehicles = [...allVehicles, ...secondaryVehicles];
          } catch (error) {
            this.api.error('Error fetching vehicles from secondary account:', error);
          }
        }

        // Apply the same filtering logic as before
        return await this._filterVehicles(allVehicles);
      } else {
        // Get vehicles from a specific account
        return await this._getVehiclesForAccount(accountId);
      }
    } catch (error) {
      this.api.error('Failed to fetch vehicles:', error);
      throw new Error(`Failed to fetch vehicles: ${error.message}`);
    }
  }

  /**
   * Get vehicles for a specific account
   * @param {string} accountId - The account ID to use
   * @returns {Promise<Array>} List of vehicles
   * @private
   */
  async _getVehiclesForAccount(accountId) {
    try {
      const cacheKey = `vehicles_${accountId}`;
      const cachedData = this.requestCache.get(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      // Get token for the specified account
      const accessToken = await this.getAccessToken(null, accountId);

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

      // Store the account ID with each vehicle for later reference
      responseData.data.forEach(vehicle => {
        vehicle._accountId = accountId;
      });

      // Cache the response with 1-minute TTL
      this.requestCache.set(cacheKey, responseData.data, 60000);

      return responseData.data;
    } catch (error) {
      this.api.error(`Failed to fetch vehicles for account ${accountId}:`, error);
      return [];
    }
  }

  /**
   * Filter vehicles based on security rules
   * @param {Array} vehicles - List of vehicles to filter
   * @returns {Promise<Array>} Filtered list of vehicles
   * @private
   */
  async _filterVehicles(vehicles) {
    try {
      // Get the installation ID and Homey ID to create a unique identifier
      const homeyId = this.api.id || 'homey';
      const installationId = this.api.settings.get('installation_id');

      // Check if we're in pairing mode (determined by checking if we're called from the pairing process)
      // This is a heuristic - we check the call stack for pairing-related functions
      const isPairingMode = new Error().stack.includes('onPair') ||
                           new Error().stack.includes('list_devices');

      // Get authorized VINs from settings
      const authorizedVins = this.api.settings.get('authorized_vins') || [];
      this.api.log(`Found ${authorizedVins.length} authorized VINs in settings`);

      // Get all existing devices to find their VINs (as a backup)
      const existingVins = [];

      // Try to get devices from the driver
      if (this.api.drivers) {
        try {
          const driver = this.api.drivers.getDriver('cars');
          if (driver) {
            const devices = await driver.getDevices();
            if (devices && devices.length > 0) {
              // Extract VINs from existing devices
              devices.forEach(device => {
                const deviceData = device.getData();
                if (deviceData && deviceData.vin) {
                  existingVins.push(deviceData.vin);
                }
              });
            }
          }
        } catch (driverError) {
          this.api.error('Error getting devices from driver:', driverError);
        }
      }

      // Combine authorized VINs and existing VINs for the most comprehensive list
      const allAuthorizedVins = [...new Set([...authorizedVins, ...existingVins])];

      // If we have authorized VINs, filter by them first (primary security measure)
      if (allAuthorizedVins.length > 0) {
        this.api.log(`Filtering vehicles by ${allAuthorizedVins.length} authorized VINs`);
        const filteredVehicles = vehicles.filter(vehicle =>
          allAuthorizedVins.includes(vehicle.information?.vin)
        );

        if (filteredVehicles.length > 0) {
          this.api.log(`Found ${filteredVehicles.length} vehicles matching authorized VINs`);
          return filteredVehicles;
        } else {
          this.api.log(`No vehicles found matching authorized VINs. Using user ID filter.`);
        }
      }

      // If no authorized VINs or no matches, try filtering by user ID in the vehicle data
      // Use the more unique user ID that includes installation ID
      const userId = installationId ? `homey-${homeyId}-${installationId}` : `homey-${homeyId}`;
      this.api.log(`Filtering vehicles by user ID: ${userId}`);

      const userVehicles = vehicles.filter(vehicle =>
        vehicle.userId === userId ||
        (vehicle.user && vehicle.user.id === userId)
      );

      if (userVehicles.length > 0) {
        this.api.log(`Found ${userVehicles.length} vehicles for user ID ${userId}`);

        // Store the VINs of these vehicles in the authorized list if they're not already there
        userVehicles.forEach(vehicle => {
          const vin = vehicle.information?.vin;
          if (vin && !authorizedVins.includes(vin)) {
            authorizedVins.push(vin);
            this.api.log(`Adding VIN ${vin} to authorized list from user ID match`);
          }
        });

        // Update the authorized VINs in settings
        if (authorizedVins.length > 0) {
          this.api.settings.set('authorized_vins', authorizedVins);
        }

        return userVehicles;
      }

      // SECURITY IMPROVEMENT: Never return all vehicles, even in pairing mode
      // Instead, return an empty array which will trigger a helpful error message
      this.api.log('No vehicles found matching filters. Returning empty list for security.');
      return [];
    } catch (filterError) {
      this.api.error('Error filtering vehicles:', filterError);
      // For security, always return empty array on error
      return [];
    }
  }

  /**
   * Get data for a specific vehicle
   * @param {string} vehicleId - The vehicle ID
   * @param {string} accountId - Optional explicit account ID to use
   * @returns {Promise<Object>} Vehicle data
   */
  async getVehicleData(vehicleId, accountId = null) {
    try {
      const cacheKey = `vehicle_${vehicleId}`;
      const cachedData = this.requestCache.get(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      // If no account ID is provided, try to determine which account this vehicle belongs to
      if (!accountId) {
        // First check if we have a VIN-to-account mapping
        const vehicles = await this.getVehicles();
        const vehicle = vehicles.find(v => v.id === vehicleId);

        if (vehicle && vehicle._accountId) {
          accountId = vehicle._accountId;
          this.api.log(`Using account ${accountId} for vehicle ${vehicleId} based on vehicle list`);
        } else if (vehicle && vehicle.information && vehicle.information.vin) {
          // If we have the VIN, check if it's mapped to an account
          const vin = vehicle.information.vin;
          accountId = this.accountManager.getVehicleAccount(vin);
          this.api.log(`Using account ${accountId} for vehicle ${vehicleId} (VIN: ${vin}) based on mapping`);
        }
      }

      // Get token for the appropriate account
      const accessToken = await this.getAccessToken(vehicleId, accountId);

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
   * @param {string} vehicleId - Optional vehicle ID to determine which account to use
   * @returns {Promise<Object>} Action status
   */
  async getActionStatus(actionId, vehicleId = null) {
    try {
      // Get token for the appropriate account if vehicle ID is provided
      const accessToken = await this.getAccessToken(vehicleId);

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

      // Get token for the appropriate account
      const accessToken = await this.getAccessToken(vehicleId);

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

      // Get token for the appropriate account
      const accessToken = await this.getAccessToken(vehicleId);

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
