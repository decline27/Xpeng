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
          },
        }
      );

      const data = await response.json();
      this.requestCache.set(cacheKey, data);
      return data;
    } catch (error) {
      this.api.error(`Failed to get vehicle data for ${vehicleId}:`, error.message);
      throw new Error(`Failed to get vehicle data: ${error.message}`);
    }
  }

  async startCharging(clientId, clientSecret, vehicleId) {
    try {
      // First check if the vehicle exists and is in a valid state
      const vehicleData = await this.getVehicleData(clientId, clientSecret, vehicleId);
      if (!vehicleData) {
        throw new Error('Vehicle not found');
      }

      // Check if vehicle is in a state where it can be charged
      if (!vehicleData.isPluggedIn) {
        throw new Error('Vehicle is not plugged in');
      }

      if (vehicleData.chargeState === 'charging') {
        throw new Error('Vehicle is already charging');
      }

      if (vehicleData.batteryLevel >= 100) {
        throw new Error('Battery is already full');
      }
      
      const accessToken = await this.getAccessToken(clientId, clientSecret);
      const response = await this.makeRequest(
        `https://enode-api.production.enode.io/vehicles/${vehicleId}/charging/start`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const data = await response.json();
      // Invalidate vehicle data cache after state change
      this.requestCache.clear(`vehicle_${vehicleId}`);

      // Log successful charging start
      this.api.log(`Successfully started charging for vehicle ${vehicleId}`);
      
      return data;
    } catch (error) {
      // Log the detailed error
      this.api.error(`Failed to start charging for vehicle ${vehicleId}:`, error.message);
      throw new Error(`Failed to start charging: ${error.message}`);
    }
  }

  async stopCharging(clientId, clientSecret, vehicleId) {
    try {
      // First check if the vehicle exists and is in a valid state
      const vehicleData = await this.getVehicleData(clientId, clientSecret, vehicleId);
      if (!vehicleData) {
        throw new Error('Vehicle not found');
      }

      // Check if vehicle is in a state where charging can be stopped
      if (!vehicleData.isPluggedIn) {
        throw new Error('Vehicle is not plugged in');
      }

      if (vehicleData.chargeState !== 'charging') {
        throw new Error('Vehicle is not currently charging');
      }

      const accessToken = await this.getAccessToken(clientId, clientSecret);
      const response = await this.makeRequest(
        `https://enode-api.production.enode.io/vehicles/${vehicleId}/charging/stop`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const data = await response.json();
      // Invalidate vehicle data cache after state change
      this.requestCache.clear(`vehicle_${vehicleId}`);

      // Log successful charging stop
      this.api.log(`Successfully stopped charging for vehicle ${vehicleId}`);
      
      return data;
    } catch (error) {
      // Log the detailed error
      this.api.error(`Failed to stop charging for vehicle ${vehicleId}:`, error.message);
      throw new Error(`Failed to stop charging: ${error.message}`);
    }
  }
}

module.exports = EnodeAPI;
