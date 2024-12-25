const fetch = require('node-fetch');
const Homey = require('homey');

class EnodeAPI {
  constructor(api) {
    this.api = api;
  }

  async getAccessToken(clientId, clientSecret) {
    try {
      const response = await fetch('https://oauth.production.enode.io/oauth2/token', {
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
      return data.access_token;
    } catch (error) {
      throw new Error(`Error fetching access token: ${error.message}`);
    }
  }

  async generateVehicleLink(clientId, clientSecret, userId) {
    try {
      const accessToken = await this.getAccessToken(clientId, clientSecret);
      const response = await fetch(
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
      const accessToken = await this.getAccessToken(clientId, clientSecret);
      const response = await fetch(
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
      
      // Check if response has data property and it's an array
      if (!responseData.data || !Array.isArray(responseData.data)) {
        this.api.error('Invalid response format:', responseData);
        throw new Error('Invalid response format from Enode API');
      }

      return responseData.data;
    } catch (error) {
      throw new Error(`Failed to fetch vehicles: ${error.message}`);
    }
  }

  async getVehicleData(clientId, clientSecret, vehicleId) {
    try {
      const accessToken = await this.getAccessToken(clientId, clientSecret);
      const response = await fetch(
        `https://enode-api.production.enode.io/vehicles/${vehicleId}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
        }
      );

      const data = await response.json();
      if (!data) {
        throw new Error('Invalid response format from Enode API');
      }

      return data;
    } catch (error) {
      throw new Error(`Failed to fetch vehicle data: ${error.message}`);
    }
  }
}

module.exports = EnodeAPI;
