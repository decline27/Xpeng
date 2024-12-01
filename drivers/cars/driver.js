const Homey = require('homey');
const https = require('https');
const querystring = require('querystring');

class XpengCarDriver extends Homey.Driver {
  async onInit() {
    this.log('XpengCarDriver has been initialized');

    // Register Flow Actions
    this.homey.flow.getActionCard('start_charging')
      .registerRunListener(async (args, state) => {
        const device = args.device;
        await device.onActionStartCharging();
      });

    this.homey.flow.getActionCard('stop_charging')
      .registerRunListener(async (args, state) => {
        const device = args.device;
        await device.onActionStopCharging();
      });
  }

  async getAccessToken(clientId, clientSecret) {
    const url = 'https://oauth.production.enode.io/oauth2/token';
    
    // Create Basic Auth header
    const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    
    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    };

    // Create form data
    const data = new URLSearchParams();
    data.append('grant_type', 'client_credentials');

    return new Promise((resolve, reject) => {
      this.log('Attempting to get access token...');
      const req = https.request(url, options, (res) => {
        let responseData = '';
        res.on('data', (chunk) => { responseData += chunk; });
        res.on('end', () => {
          this.log(`Token request status code: ${res.statusCode}`);
          
          if (res.statusCode === 200) {
            try {
              const response = JSON.parse(responseData);
              if (response.access_token) {
                this.log('Successfully obtained access token');
                resolve(response.access_token);
              } else {
                this.error('No access token in response');
                reject(new Error('No access token received'));
              }
            } catch (error) {
              this.error('Error parsing access token response:', error);
              reject(new Error('Failed to parse authentication response'));
            }
          } else {
            try {
              const errorResponse = JSON.parse(responseData);
              this.error('Authentication error:', errorResponse);
              reject(new Error(errorResponse.error_description || 'Authentication failed'));
            } catch (e) {
              this.error(`Failed to get access token: ${res.statusCode} ${res.statusMessage}`);
              reject(new Error(`Authentication failed with status ${res.statusCode}`));
            }
          }
        });
      });

      req.on('error', (error) => {
        this.error('Network error in getAccessToken:', error);
        reject(new Error('Network error during authentication'));
      });

      req.write(data.toString());
      req.end();
    });
  }

  async getVehicles(accessToken) {
    const url = 'https://enode-api.production.enode.io/vehicles';
    
    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    };

    return new Promise((resolve, reject) => {
      this.log('Fetching vehicles...');
      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          this.log(`Vehicles request status code: ${res.statusCode}`);
          
          if (res.statusCode === 200) {
            try {
              const response = JSON.parse(data);
              if (Array.isArray(response.data)) {
                this.log(`Found ${response.data.length} vehicles`);
                resolve(response.data);
              } else {
                this.error('Invalid vehicles response format');
                reject(new Error('Invalid response format from vehicles API'));
              }
            } catch (error) {
              this.error('Error parsing vehicles response:', error);
              reject(new Error('Failed to parse vehicles data'));
            }
          } else {
            try {
              const errorResponse = JSON.parse(data);
              this.error('Vehicles API error:', errorResponse);
              reject(new Error(errorResponse.message || `Failed to get vehicles: ${res.statusCode}`));
            } catch (e) {
              this.error(`Failed to get vehicles: ${res.statusCode} ${res.statusMessage}`);
              reject(new Error(`Failed to get vehicles data (${res.statusCode})`));
            }
          }
        });
      });

      req.on('error', (error) => {
        this.error('Network error in getVehicles:', error);
        reject(new Error('Network error while fetching vehicles'));
      });

      req.end();
    });
  }

  async testConnection(clientId, clientSecret) {
    try {
      this.log('Testing connection with provided credentials...');
      const accessToken = await this.getAccessToken(clientId, clientSecret);
      if (!accessToken) {
        throw new Error('Failed to obtain access token');
      }

      const vehicles = await this.getVehicles(accessToken);
      if (!vehicles || vehicles.length === 0) {
        throw new Error('No vehicles found with these credentials');
      }
      
      this.log('Connection test successful, found vehicles:', vehicles.length);
      return true;
    } catch (error) {
      this.error('Connection test failed:', error.message);
      throw error;
    }
  }

  async onPair(session) {
    let credentials = {};

    session.setHandler('validate', async (data) => {
      try {
        if (!data.clientId || !data.clientSecret) {
          throw new Error('Client ID and Client Secret are required');
        }

        credentials = {
          clientId: data.clientId,
          clientSecret: data.clientSecret
        };

        this.log('Validating credentials...');
        await this.testConnection(credentials.clientId, credentials.clientSecret);
        this.log('Credentials validated successfully');
        return true;
      } catch (error) {
        const errorMsg = error.message || 'Unknown error occurred';
        this.error('Validation failed:', errorMsg);
        throw new Error(errorMsg);
      }
    });

    session.setHandler('list_devices', async () => {
      try {
        const accessToken = await this.getAccessToken(credentials.clientId, credentials.clientSecret);
        if (!accessToken) {
          throw new Error('Failed to get access token');
        }

        const vehicles = await this.getVehicles(accessToken);
        if (!vehicles || vehicles.length === 0) {
          throw new Error('No vehicles found');
        }

        return vehicles.map(vehicle => ({
          name: `${vehicle.information?.brand || 'Unknown'} ${vehicle.information?.model || 'Car'}`,
          data: {
            id: vehicle.id,
            clientId: credentials.clientId,
            clientSecret: credentials.clientSecret
          },
          store: {
            lastKnownLocation: vehicle.location,
            lastSeenAt: new Date().toISOString()
          }
        }));
      } catch (error) {
        this.error('Error listing devices:', error);
        throw error;
      }
    });
  }
}

module.exports = XpengCarDriver;
