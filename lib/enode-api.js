const fetch = require('node-fetch');
const Homey = require('homey');
const { TokenCache, RateLimiter, RequestCache, retryWithBackoff } = require('./utils');

class EnodeAPI {
  constructor(api) {
    this.api = api;
    this.tokenCache = new TokenCache();
    this.rateLimiter = new RateLimiter(10, 1000); // 10 requests per second
    this.requestCache = new RequestCache(1000, 60000); // Cache 1000 items, 1 minute TTL
  }

  async makeRequest(url, options) {
    await this.rateLimiter.throttle();
    
    return retryWithBackoff(async () => {
      const response = await fetch(url, options);
      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'No error body');
        throw new Error(`HTTP error! status: ${response.status}, url: ${url}, body: ${errorBody}`);
      }
      return response;
    });
  }

  async getAccessToken(clientId, clientSecret) {
    try {
      // Check cache first
      const cachedToken = this.tokenCache.getToken();
      if (cachedToken) {
        return cachedToken;
      }

      const response = await this.makeRequest('https://oauth.production.enode.io/oauth2/token', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });

      const data = await response.json();
      if (!data.access_token) {
        throw new Error('Access token missing from response');
      }

      // Cache the token
      this.tokenCache.setToken(data.access_token, data.expires_in || 3600);
      return data.access_token;
    } catch (error) {
      this.tokenCache.clear();
      throw new Error(`Error fetching access token: ${error.message}`);
    }
  }

  async generateVehicleLink(clientId, clientSecret, userId) {
    try {
      const accessToken = await this.getAccessToken(clientId, clientSecret);
      const response = await this.makeRequest(
        `https://enode-api.production.enode.io/users/${clientId}/link`,
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
      throw new Error(`Failed to generate vehicle link: ${error.message}`);
    }
  }

  async getVehicles(clientId, clientSecret) {
    try {
      const cacheKey = `vehicles_${clientId}`;
      const cachedData = this.requestCache.get(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      const accessToken = await this.getAccessToken(clientId, clientSecret);
      const response = await this.makeRequest(
        `https://enode-api.production.enode.io/vehicles`,
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
      throw new Error(`Failed to fetch vehicles: ${error.message}`);
    }
  }

  async getVehicleData(clientId, clientSecret, vehicleId) {
    try {
      const cacheKey = `vehicle_${vehicleId}`;
      const cachedData = this.requestCache.get(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      const accessToken = await this.getAccessToken(clientId, clientSecret);
      const response = await this.makeRequest(
        `https://enode-api.production.enode.io/vehicles/${vehicleId}`,
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

  async getActionStatus(clientId, clientSecret, actionId) {
    try {
      const accessToken = await this.getAccessToken(clientId, clientSecret);
      const response = await this.makeRequest(
        `https://enode-api.production.enode.io/vehicles/actions/${actionId}`,
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

  async waitForAction(clientId, clientSecret, actionId, pollIntervalMs = 2000) {
    while (true) {
      const status = await this.getActionStatus(clientId, clientSecret, actionId);
      
      switch (status.state) {
        case 'CONFIRMED':
          return status;
        case 'FAILED':
          throw new Error(`Action failed: ${status.failureReason || 'Unknown reason'}`);
        case 'CANCELLED':
          throw new Error('Action was cancelled');
        case 'PENDING':
          // Action is still in progress, wait before checking again
          await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
          break;
        default:
          throw new Error(`Unknown action state: ${status.state}`);
      }
    }
  }

  async refreshVehicleData(clientId, clientSecret, vehicleId, waitMs = 2000) {
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
        return await this.getVehicleData(clientId, clientSecret, vehicleId);
      }

      const accessToken = await this.getAccessToken(clientId, clientSecret);
      try {
        await this.makeRequest(
          `https://enode-api.production.enode.io/vehicles/${vehicleId}/refresh-hint`,
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
        const freshData = await this.getVehicleData(clientId, clientSecret, vehicleId);
        return freshData;
      } catch (error) {
        if (error.status === 429) {
          this.api.log(`Rate limit hit for vehicle ${vehicleId}, using cached data`);
          // Force counter to limit to prevent more attempts this hour
          this.requestCache.set(refreshCountKey, 9);
          return await this.getVehicleData(clientId, clientSecret, vehicleId);
        }
        throw error;
      }
    } catch (error) {
      // Non-blocking error, just log it
      this.api.error(`Failed to refresh vehicle data: ${error.message}`);
      return null;
    }
  }

  async startCharging(clientId, clientSecret, vehicleId) {
    try {
      // First verify that this vehicle exists in the user's account
      const vehicles = await this.getVehicles(clientId, clientSecret);
      const vehicle = vehicles.find(v => v.id === vehicleId);
      
      if (!vehicle) {
        this.api.error(`Vehicle ${vehicleId} not found in user's account. Available vehicles:`, 
          vehicles.map(v => ({ id: v.id, name: v.name }))
        );
        throw new Error('Vehicle not found in user\'s account');
      }

      this.api.log(`Found vehicle ${vehicleId} in user's account:`, vehicle);

      // Try to get fresh data before checking state
      const vehicleData = await this.refreshVehicleData(clientId, clientSecret, vehicleId) || 
                         await this.getVehicleData(clientId, clientSecret, vehicleId);
      
      if (!vehicleData) {
        throw new Error('Vehicle not found');
      }

      // Check if vehicle is in a state where it can be charged
      if (!vehicleData.chargeState?.isPluggedIn) {
        this.api.error(`Vehicle ${vehicleId} not plugged in. Charge state:`, vehicleData.chargeState);
        throw new Error('Vehicle is not plugged in');
      }

      // More lenient validation for charging state
      if (vehicleData.chargeState?.batteryLevel >= 100) {
        throw new Error('Battery is already full');
      }
      
      const accessToken = await this.getAccessToken(clientId, clientSecret);

      // Log the API request details
      this.api.log('Sending charging start request:', {
        vehicleId,
        endpoint: `/vehicles/${vehicleId}/charging`,
        method: 'POST',
        action: 'START'
      });

      const response = await this.makeRequest(
        `https://enode-api.production.enode.io/vehicles/${vehicleId}/charging`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            action: 'START'
          })
        }
      );

      const responseData = await response.json();
      // For charging commands, the response might not be wrapped in a data field
      const data = responseData.data || responseData;

      // Invalidate vehicle data cache after state change
      this.requestCache.clear(`vehicle_${vehicleId}`);

      // Log successful charging start
      this.api.log(`Successfully started charging for vehicle ${vehicleId}:`, data);

      // Wait for the action to complete
      const finalStatus = await this.waitForAction(clientId, clientSecret, data.id);
      this.api.log(`Charging action completed for vehicle ${vehicleId}:`, finalStatus);
      
      return finalStatus;
    } catch (error) {
      // Log the detailed error
      this.api.error(`Failed to start charging for vehicle ${vehicleId}:`, error.message);
      throw new Error(`Failed to start charging: ${error.message}`);
    }
  }

  async stopCharging(clientId, clientSecret, vehicleId) {
    try {
      // First verify that this vehicle exists in the user's account
      const vehicles = await this.getVehicles(clientId, clientSecret);
      const vehicle = vehicles.find(v => v.id === vehicleId);
      
      if (!vehicle) {
        this.api.error(`Vehicle ${vehicleId} not found in user's account. Available vehicles:`, 
          vehicles.map(v => ({ id: v.id, name: v.name }))
        );
        throw new Error('Vehicle not found in user\'s account');
      }

      // Try to get fresh data before checking state
      const vehicleData = await this.refreshVehicleData(clientId, clientSecret, vehicleId) || 
                         await this.getVehicleData(clientId, clientSecret, vehicleId);
      
      if (!vehicleData) {
        throw new Error('Vehicle not found');
      }

      // More lenient validation - only check if plugged in
      if (!vehicleData.chargeState?.isPluggedIn) {
        throw new Error('Vehicle is not plugged in');
      }

      const accessToken = await this.getAccessToken(clientId, clientSecret);

      // Log the API request details
      this.api.log('Sending charging stop request:', {
        vehicleId,
        endpoint: `/vehicles/${vehicleId}/charging`,
        method: 'POST',
        action: 'STOP'
      });

      const response = await this.makeRequest(
        `https://enode-api.production.enode.io/vehicles/${vehicleId}/charging`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          body: JSON.stringify({
            action: 'STOP'
          })
        }
      );

      const responseData = await response.json();
      // For charging commands, the response might not be wrapped in a data field
      const data = responseData.data || responseData;

      // Invalidate vehicle data cache after state change
      this.requestCache.clear(`vehicle_${vehicleId}`);

      // Log successful charging stop
      this.api.log(`Successfully stopped charging for vehicle ${vehicleId}:`, data);

      // Wait for the action to complete
      const finalStatus = await this.waitForAction(clientId, clientSecret, data.id);
      this.api.log(`Charging action completed for vehicle ${vehicleId}:`, finalStatus);
      
      return finalStatus;
    } catch (error) {
      // Log the detailed error
      this.api.error(`Failed to stop charging for vehicle ${vehicleId}:`, error.message);
      throw new Error(`Failed to stop charging: ${error.message}`);
    }
  }
}

module.exports = EnodeAPI;
