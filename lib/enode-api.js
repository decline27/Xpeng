const fetch = require('node-fetch');
const Homey = require('homey');
const { RateLimiter, RequestCache, retryWithBackoff } = require('./utils');
const { getMachineToken, clearTokenCache } = require('./enode-machine-token');
const AccountManager = require('./account-manager');
const ClientManager = require('./client-manager');
const { getUserIdCandidates } = require('./user-identity');

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

    // Initialize client manager
    this.clientManager = new ClientManager(api);

    // Initialize account manager (for backward compatibility)
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
  async makeRequest(url, options, timeoutMs = 50000) {
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
   * @param {string} vehicleId - Optional vehicle ID to determine which client to use
   * @param {string} clientId - Optional explicit client ID to use
   * @returns {Promise<string>} The access token
   */
  async getAccessToken(vehicleId = null, clientId = null) {
    try {
      // Determine which client to use
      let credentials;

      try {
        // First try using the ClientManager
        if (clientId) {
          // If client ID is explicitly provided, use it
          credentials = this.clientManager.getClientCredentials(clientId);
        } else if (vehicleId) {
          // If vehicle ID is provided, get the client associated with it
          credentials = this.clientManager.getVehicleCredentials(vehicleId);
        } else {
          // Otherwise use the default client
          credentials = this.clientManager.getClientCredentials();
        }

        // Get token using the appropriate credentials
        return await getMachineToken(
          {
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret
          },
          credentials.clientIdentifier
        );
      } catch (clientError) {
        // Check if this is an authentication error (401) - don't fallback, just rethrow
        if (clientError.message && (clientError.message.includes('401') || clientError.message.includes('invalid_client'))) {
          this.api.error(`Authentication failed for client ${clientId}: ${clientError.message}`);
          throw clientError; // Rethrow to let caller handle it
        }

        // Fallback to AccountManager for backward compatibility (only for other errors)
        this.api.log('Falling back to AccountManager for credentials:', clientError.message);

        if (clientId) {
          // If client ID is explicitly provided, use it as account ID
          credentials = this.accountManager.getCredentials(clientId);
        } else if (vehicleId) {
          // If vehicle ID is provided, get the account associated with it
          credentials = this.accountManager.getVehicleCredentials(vehicleId);
        } else {
          // Otherwise use the default account
          credentials = this.accountManager.getCredentials();
        }

        // Get token using the appropriate credentials
        return await getMachineToken(credentials, credentials.accountId);
      }
    } catch (error) {
      this.api.error('Error fetching access token:', error);
      throw new Error(`Error fetching access token: ${error.message}`);
    }
  }

  /**
   * Find which client (if any) already hosts a given Enode user.
   * Enode keeps a separate user namespace per client, so a returning user must re-link through
   * the client they already exist on — otherwise the car is duplicated into another silo.
   * Uses a direct GET (not makeRequest) so an expected 404 isn't retried with backoff.
   * @param {string} userId
   * @returns {Promise<string|null>} the client identifier hosting the user, or null
   */
  async findClientForUser(userId) {
    if (!userId) {
      return null;
    }
    const cacheKey = `userclient_${userId}`;
    const cached = this.requestCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const clients = this.clientManager.getAllClients();
    for (const client of clients) {
      try {
        const token = await this.getAccessToken(null, client.id);
        await this.rateLimiter.throttle();
        const response = await fetch(`${this.apiBaseUrl}/users/${userId}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        });
        if (response.ok) {
          this.requestCache.set(cacheKey, client.id, 60000);
          this.api.log(`User ${userId} already exists on client ${client.id} — pinning re-link there`);
          return client.id;
        }
        // 404 => user not on this client; anything else => skip this client and try the next.
      } catch (error) {
        this.api.error(`findClientForUser: error checking client ${client.id}: ${error.message}`);
      }
    }
    return null;
  }

  /**
   * Generate a vehicle link URL for user authentication
   * @param {string} userId - Unique user ID for this session
   * @param {string} clientId - Optional client ID to use for link generation
   * @returns {Promise<string>} The link URL
   */
  async generateVehicleLink(userId, clientId = null) {
    try {
      // If no client ID is specified, prefer the client the user already exists on (so a
      // returning user re-links into the same Enode user instead of creating a duplicate).
      let pinnedClientId = null;
      if (!clientId) {
        try {
          pinnedClientId = await this.findClientForUser(userId);
        } catch (error) {
          this.api.error(`findClientForUser failed, will fall back to rotation: ${error.message}`);
        }
        if (pinnedClientId) {
          clientId = pinnedClientId;
        } else {
          try {
            clientId = this.clientManager.getDefaultClient();
            this.api.log(`Auto-selected client for link generation: ${clientId}`);
          } catch (error) {
            // Fallback to account manager
            clientId = this.accountManager.getDefaultAccount();
            this.api.log(`Falling back to account manager default: ${clientId}`);
          }
        }
      }

      // Build the list of clients to try. If the user is pinned to a client they already
      // exist on, use ONLY that client — rotating to another client would create a duplicate
      // in a separate Enode silo. New users still rotate across clients for capacity.
      let clientsToTry = [];
      if (pinnedClientId) {
        clientsToTry = [pinnedClientId];
      } else {
        try {
          const allClients = this.clientManager.getAllClients();
          if (allClients.length > 0) {
            // If a specific client was requested, try it first, then others
            if (clientId) {
              clientsToTry = [clientId, ...allClients.map(c => c.id).filter(id => id !== clientId)];
            } else {
              clientsToTry = allClients.map(c => c.id);
            }
          } else {
            // Fallback to single client
            clientsToTry = [clientId];
          }
        } catch (error) {
          this.api.log('Error getting client list, using single client:', error);
          clientsToTry = [clientId];
        }
      }

      let lastError = null;

      // Try each client until one succeeds or we run out of clients
      for (const currentClientId of clientsToTry) {
        try {
          this.api.log(`Generating vehicle link using client: ${currentClientId}`);

          // Get token for the specified client
          const accessToken = await this.getAccessToken(null, currentClientId);

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

          this.api.log(`Successfully generated vehicle link using client: ${currentClientId}`);
          return data.linkUrl;

        } catch (error) {
          lastError = error;

          // Check if this is a connection limit error
          if (error.message && error.message.includes('Connections limit reached')) {
            this.api.log(`Client ${currentClientId} has reached connection limit, trying next client...`);
            continue; // Try next client
          } else {
            // For other errors, also try next client but log the error
            this.api.log(`Error with client ${currentClientId}: ${error.message}, trying next client...`);
            continue;
          }
        }
      }

      // If we get here, all clients failed
      this.api.error('All clients failed to generate vehicle link. Last error:', lastError);
      throw new Error(`Failed to generate vehicle link with all available clients: ${lastError?.message || 'Unknown error'}`);

    } catch (error) {
      this.api.error('Failed to generate vehicle link:', error);
      throw new Error(`Failed to generate vehicle link: ${error.message}`);
    }
  }

  /**
   * Get all vehicles for the authenticated user
   * @param {string} clientId - Optional client ID to use
   * @param {boolean} getAllClients - Whether to get vehicles from all clients
   * @param {boolean} skipFilter - Whether to skip security filtering (admin use only)
   * @returns {Promise<Array>} List of vehicles
   */
  async getVehicles(clientId = null, getAllClients = true, skipFilter = false) {
    try {
      // If getAllClients is true, we'll fetch vehicles from all clients and merge them
      if (getAllClients) {
        let allVehicles = [];

        try {
          // Try using ClientManager first
          const clients = this.clientManager.getAllClients();

          if (clients.length === 0) {
            this.api.log('No clients found in ClientManager, falling back to AccountManager');
            // Fallback to AccountManager
            return this._getVehiclesUsingAccountManager(skipFilter);
          }

          this.api.log(`Found ${clients.length} clients in registry`);

          // Get vehicles from each client
          for (const client of clients) {
            try {
              // Validate client has required credentials before attempting to fetch
              if (!client.enodeClientId || !client.enodeClientSecret) {
                this.api.log(`Skipping client ${client.id}: Missing credentials`);
                continue;
              }

              const clientVehicles = await this._getVehiclesForClient(client.id);

              // Tag vehicles with client info for later reference. Map by BOTH the Enode vehicle
              // id and the VIN: control operations resolve the client by vehicle id, while reads
              // and the account manager use the VIN. Mapping only by VIN previously caused
              // commands to fall back to the default client ("read only" behaviour).
              clientVehicles.forEach(vehicle => {
                try {
                  if (vehicle.id) {
                    this.clientManager.setVehicleClient(vehicle.id, client.id);
                  }
                  if (vehicle.information && vehicle.information.vin) {
                    this.clientManager.setVehicleClient(vehicle.information.vin, client.id);
                  }
                } catch (error) {
                  this.api.error(`Error associating vehicle ${vehicle.id} with client ${client.id}:`, error);
                }
              });

              allVehicles = [...allVehicles, ...clientVehicles];
              this.api.log(`Added ${clientVehicles.length} vehicles from client ${client.id}`);
            } catch (error) {
              this.api.error(`Error fetching vehicles from client ${client.id}:`, error);
              // Continue with next client instead of failing entirely
            }
          }

          // Deduplicate vehicles by VIN, keeping the most recently seen entry
          const vehiclesByVin = new Map();
          for (const vehicle of allVehicles) {
            const vin = vehicle.information?.vin;
            if (!vin) continue;
            const existing = vehiclesByVin.get(vin);
            if (!existing || (vehicle.lastSeen && (!existing.lastSeen || vehicle.lastSeen > existing.lastSeen))) {
              vehiclesByVin.set(vin, vehicle);
            }
          }
          const uniqueVehicles = Array.from(vehiclesByVin.values());
          if (uniqueVehicles.length < allVehicles.length) {
            this.api.log(`Deduplicated ${allVehicles.length} vehicles to ${uniqueVehicles.length} unique VINs`);
          }

          // Apply filtering logic
          if (skipFilter) {
            this.api.log(`Skipping security filter for ${uniqueVehicles.length} vehicles`);
            return uniqueVehicles;
          }
          return await this._filterVehicles(uniqueVehicles);
        } catch (clientError) {
          this.api.error('Error using ClientManager, falling back to AccountManager:', clientError);
          // Fallback to AccountManager
          return this._getVehiclesUsingAccountManager(skipFilter);
        }
      } else {
        // Get vehicles from a specific client
        const clientVehicles = await this._getVehiclesForClient(clientId);

        if (skipFilter) {
          return clientVehicles;
        }
        return await this._filterVehicles(clientVehicles);
      }
    } catch (error) {
      this.api.error('Failed to fetch vehicles:', error);
      throw new Error(`Failed to fetch vehicles: ${error.message}`);
    }
  }

  /**
   * Get vehicles using the AccountManager (legacy method)
   * @param {boolean} skipFilter - Whether to skip security filtering
   * @returns {Promise<Array>} List of vehicles
   * @private
   */
  async _getVehiclesUsingAccountManager(skipFilter = false) {
    const accountStatus = this.accountManager.checkAccountsStatus();
    let allVehicles = [];

    // Get vehicles from primary account if configured
    if (accountStatus.primaryConfigured) {
      try {
        const primaryVehicles = await this._getVehiclesForClient(this.accountManager.ACCOUNT_1);

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
        const secondaryVehicles = await this._getVehiclesForClient(this.accountManager.ACCOUNT_2);

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
    if (skipFilter) {
      this.api.log(`Skipping security filter for ${allVehicles.length} vehicles (legacy account manager)`);
      return allVehicles;
    }
    return await this._filterVehicles(allVehicles);
  }

  /**
   * Get vehicles for a specific client
   * @param {string} clientId - The client ID to use
   * @returns {Promise<Array>} List of vehicles
   * @private
   */
  async _getVehiclesForClient(clientId) {
    try {
      const cacheKey = `vehicles_${clientId}`;
      const cachedData = this.requestCache.get(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      // Get token for the specified client
      const accessToken = await this.getAccessToken(null, clientId);

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

      // Store the client ID with each vehicle for later reference
      responseData.data.forEach(vehicle => {
        vehicle._clientId = clientId;
        // For backward compatibility
        vehicle._accountId = clientId;
      });

      // Cache the response with 1-minute TTL
      this.requestCache.set(cacheKey, responseData.data, 60000);

      return responseData.data;
    } catch (error) {
      // Check if this is an authentication error (401)
      if (error.message && (error.message.includes('401') || error.message.includes('invalid_client'))) {
        this.api.error(`Authentication failed for client ${clientId}: Invalid or expired credentials. This client will be skipped.`);
        // Return empty array to allow other clients to continue
        return [];
      }

      // For other errors, log and return empty array to not break the flow
      this.api.error(`Failed to fetch vehicles for client ${clientId}:`, error);
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

      // If no authorized VINs or no matches, filter by user ID in the vehicle data.
      // Dual-match the new stable user ID AND the legacy id so a user mid-migration still sees
      // their already-linked car.
      const userIdCandidates = await getUserIdCandidates(this.api);
      this.api.log(`Filtering vehicles by user IDs: ${userIdCandidates.join(', ')}`);

      const userVehicles = vehicles.filter(vehicle =>
        userIdCandidates.includes(vehicle.userId) ||
        (vehicle.user && userIdCandidates.includes(vehicle.user.id))
      );

      if (userVehicles.length > 0) {
        this.api.log(`Found ${userVehicles.length} vehicles for user IDs ${userIdCandidates.join(', ')}`);

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
  async getActionStatus(actionId, vehicleId = null, accountId = null) {
    try {
      // Get token for the resolved client; an action lives on the same client that issued it,
      // so polling it on the default client would 404 even after a successful command.
      const accessToken = await this.getAccessToken(vehicleId, accountId);

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
  async waitForAction(actionId, pollIntervalMs = 2000, maxAttempts = 30, accountId = null) {
    let attempts = 0;
    const maxWaitTimeMs = maxAttempts * pollIntervalMs;

    while (attempts < maxAttempts) {
      attempts++;
      const status = await this.getActionStatus(actionId, null, accountId);

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

    throw new Error(`Action timed out after ${maxWaitTimeMs / 1000} seconds`);
  }

  /**
   * Refresh vehicle data from the vehicle
   * @param {string} vehicleId - The vehicle ID
   * @param {number} waitMs - Time to wait after refresh before fetching data
   * @returns {Promise<Object>} Updated vehicle data
   */
  async refreshVehicleData(vehicleId, waitMs = 2000, accountId = null) {
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
        this.api.log(`Skipping refresh-hint for vehicle ${vehicleId}, ${reason}. Count: ${refreshCount}, Last refresh: ${Math.round((now - lastRefresh) / 1000)}s ago`);
        // Just get cached data
        return await this.getVehicleData(vehicleId, accountId);
      }

      // Get token for the appropriate account
      const accessToken = await this.getAccessToken(vehicleId, accountId);

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
        const freshData = await this.getVehicleData(vehicleId, accountId);
        return freshData;
      } catch (error) {
        if (error.status === 429) {
          this.api.log(`Rate limit hit for vehicle ${vehicleId}, using cached data`);
          // Force counter to limit to prevent more attempts this hour
          this.requestCache.set(refreshCountKey, 9);
          return await this.getVehicleData(vehicleId, accountId);
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
  async controlCharging(vehicleId, action, accountId = null) {
    if (action !== 'START' && action !== 'STOP') {
      throw new Error(`Invalid charging action: ${action}`);
    }

    try {
      // Resolve which Enode client actually hosts this vehicle. Control commands MUST use that
      // client's token; otherwise Enode rejects them and the device behaves "read only".
      // (Reads work because they fan out across all clients, but a command targets one client.)
      if (!accountId) {
        try {
          const vehicles = await this.getVehicles();
          const match = vehicles.find(v => v.id === vehicleId);
          accountId = match?._accountId || match?._clientId || null;
          if (accountId) {
            this.api.log(`Resolved client ${accountId} for charging control of vehicle ${vehicleId}`);
          } else {
            this.api.log(`Could not resolve a specific client for vehicle ${vehicleId}; using default`);
          }
        } catch (resolveError) {
          this.api.error(`Error resolving client for vehicle ${vehicleId}: ${resolveError.message}`);
        }
      }

      // Verify vehicle exists and get current state in one operation
      let vehicleData;
      try {
        vehicleData = await this.getVehicleData(vehicleId, accountId);
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

        // Adopt the client from the matched vehicle if we still don't have one.
        if (!accountId) {
          accountId = vehicle._accountId || vehicle._clientId || null;
        }

        // Try refresh as last resort
        vehicleData = await this.refreshVehicleData(vehicleId, 2000, accountId);
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

      // Get token for the resolved client (falls back to default only if unresolved)
      const accessToken = await this.getAccessToken(vehicleId, accountId);

      // Log the API request details
      this.api.log(`Sending charging ${action.toLowerCase()} request:`, {
        vehicleId,
        accountId: accountId || 'default',
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

      // Wait for the action to complete (poll on the same client that issued the command)
      const finalStatus = await this.waitForAction(data.id, undefined, undefined, accountId);
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
  async startCharging(vehicleId, accountId = null) {
    return this.controlCharging(vehicleId, 'START', accountId);
  }

  /**
   * Stop charging a vehicle
   * @param {string} vehicleId - The vehicle ID
   * @returns {Promise<Object>} Action result
   */
  async stopCharging(vehicleId, accountId = null) {
    return this.controlCharging(vehicleId, 'STOP', accountId);
  }
  /**
   * Disconnect/unlink a user from Enode
   * @param {string} userId - The user ID to disconnect
   * @param {string} [clientId] - Optional client ID to use
   * @returns {Promise<boolean>} Success status
   */
  async disconnectUser(userId, clientId = null) {
    if (!userId) {
      throw new Error('User ID is required for disconnection');
    }

    try {
      this.api.log(`Disconnecting user ${userId} from Enode...`);

      // Get token for the specified client or default client
      const accessToken = await this.getAccessToken(null, clientId);

      const response = await this.makeRequest(
        `${this.apiBaseUrl}/users/${userId}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Accept': 'application/json'
          }
        }
      );

      this.api.log(`User ${userId} successfully disconnected from Enode`);
      return true;
    } catch (error) {
      this.api.error(`Failed to disconnect user ${userId}:`, error.message);
      throw new Error(`Failed to disconnect user: ${error.message}`);
    }
  }
}

module.exports = EnodeAPI;
