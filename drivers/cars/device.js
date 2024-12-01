const Homey = require('homey');
const https = require('https');
const querystring = require('querystring');

class XpengCarDevice extends Homey.Device {
  async onInit() {
    this.log(`Device initialized: ${this.getName()}`);

    // Retrieve settings
    const settings = this.getSettings();
    this.updateInterval = parseInt(settings.updateInterval) || 10;
    this.clientId = settings.clientId;
    this.clientSecret = settings.clientSecret;

    // Check if essential settings are present
    if (!this.clientId || !this.clientSecret || isNaN(this.updateInterval)) {
      this.log("Please set clientId, clientSecret, and updateInterval in the app settings.");
      return;
    }

    // Register capabilities
    await this.registerCapabilities();

    // Initial data fetch
    await this.updateVehicleData();

    // Set up periodic updates based on updateInterval
    this.pollingInterval = setInterval(() => this.updateVehicleData(), this.updateInterval * 60 * 1000);
  }

  // Register all capabilities
  async registerCapabilities() {
    try {
      const capabilities = [
        'batteryLevel',
        'batteryCapacity',
        'range',
        'chargingStatus',
        'chargingLimit',
        'pluggedInStatus',
        'powerDeliveryState',
        'smartCharging',
        'location',
        'lastSeen',
        'odometer',
        'vehicleBrand',
        'vehicleModel',
        'vehicleYear',
        'vehicleVin'
      ];

      for (const capability of capabilities) {
        if (!this.hasCapability(capability)) {
          this.log(`Adding missing capability: ${capability}`);
          await this.addCapability(capability);
        }
      }

      this.log('All capabilities registered successfully');
    } catch (error) {
      this.error('Error registering capabilities:', error);
    }
  }

  // Function to retrieve access token
  async getAccessToken(clientId, clientSecret) {
    const url = 'https://oauth.production.enode.io/oauth2/token';
    const postData = querystring.stringify({ grant_type: 'client_credentials' });
    const authHeader = 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64');

    const options = {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    return new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            const response = JSON.parse(data);
            resolve(response.access_token);
          } else {
            this.error(`Failed to get access token: ${res.statusCode} ${res.statusMessage}`);
            reject(new Error(`Failed to get access token: ${res.statusCode} ${res.statusMessage}`));
          }
        });
      });

      req.on('error', (error) => {
        this.error("Error in getAccessToken:", error);
        reject(error);
      });

      req.write(postData);
      req.end();
    });
  }

  // Function to retrieve vehicle data using the access token
  async getVehicleData(accessToken) {
    const url = 'https://enode-api.production.enode.io/vehicles';

    const options = {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    };

    return new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const response = JSON.parse(data);
              // Log only essential vehicle data
              this.log('Vehicle data received:', {
                brand: response.data?.[0]?.information?.brand,
                model: response.data?.[0]?.information?.model,
                batteryLevel: response.data?.[0]?.chargeState?.batteryLevel,
                isCharging: response.data?.[0]?.chargeState?.isCharging,
                isPluggedIn: response.data?.[0]?.chargeState?.isPluggedIn,
                smartChargingEnabled: response.data?.[0]?.smartChargingPolicy?.isEnabled
              });
              
              if (!response.data || !response.data[0]) {
                this.error('No vehicle data found in response');
                resolve(null);
                return;
              }

              const vehicleData = response.data[0];
              
              // Ensure all required properties exist
              vehicleData.chargeState = vehicleData.chargeState || {};
              vehicleData.information = vehicleData.information || {};
              vehicleData.location = vehicleData.location || {};
              vehicleData.odometer = vehicleData.odometer || {};
              vehicleData.smartChargingPolicy = vehicleData.smartChargingPolicy || {};

              resolve(vehicleData);
            } catch (error) {
              this.error('Error parsing vehicle data:', error);
              reject(error);
            }
          } else if (res.statusCode === 429) {
            this.error('Rate limit exceeded when getting vehicle data');
            reject(new Error('Rate limit exceeded'));
          } else {
            this.error(`Failed to get vehicle data: ${res.statusCode} ${res.statusMessage}`);
            reject(new Error(`Failed to get vehicle data: ${res.statusCode} ${res.statusMessage}`));
          }
        });
      });

      req.on('error', (error) => {
        this.error("Error in getVehicleData:", error);
        reject(error);
      });

      req.end();
    });
  }

  // Function to start charging
  async startCharging(accessToken, vehicleId) {
    const url = `https://enode-api.production.enode.io/vehicles/${vehicleId}/charging/start`;

    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    };

    return new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            this.log('Successfully started charging');
            resolve(true);
          } else {
            this.error(`Failed to start charging: ${res.statusCode} ${res.statusMessage}`);
            reject(new Error(`Failed to start charging: ${res.statusCode} ${res.statusMessage}`));
          }
        });
      });

      req.on('error', (error) => {
        this.error('Error in startCharging:', error);
        reject(error);
      });

      req.end();
    });
  }

  // Function to stop charging
  async stopCharging(accessToken, vehicleId) {
    const url = `https://enode-api.production.enode.io/vehicles/${vehicleId}/charging/stop`;

    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    };

    return new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            this.log('Successfully stopped charging');
            resolve(true);
          } else {
            this.error(`Failed to stop charging: ${res.statusCode} ${res.statusMessage}`);
            reject(new Error(`Failed to stop charging: ${res.statusCode} ${res.statusMessage}`));
          }
        });
      });

      req.on('error', (error) => {
        this.error('Error in stopCharging:', error);
        reject(error);
      });

      req.end();
    });
  }

  // Function to set smart charging
  async setSmartCharging(accessToken, vehicleId, enabled) {
    const url = `https://enode-api.production.enode.io/vehicles/${vehicleId}/smart-charging`;

    const options = {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    };

    const postData = JSON.stringify({
      isEnabled: enabled,
    });

    return new Promise((resolve, reject) => {
      const req = https.request(url, options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            this.log(`Successfully ${enabled ? 'enabled' : 'disabled'} smart charging`);
            resolve(true);
          } else {
            this.error(`Failed to set smart charging: ${res.statusCode} ${res.statusMessage}`);
            reject(new Error(`Failed to set smart charging: ${res.statusCode} ${res.statusMessage}`));
          }
        });
      });

      req.on('error', (error) => {
        this.error('Error in setSmartCharging:', error);
        reject(error);
      });

      req.write(postData);
      req.end();
    });
  }

  // Main function to update vehicle data and set Homey device capabilities
  async updateVehicleData() {
    try {
      const settings = this.getSettings();
      const clientId = settings.clientId;
      const clientSecret = settings.clientSecret;

      if (!clientId || !clientSecret) {
        this.error('Client ID or Client Secret not set');
        return;
      }

      // Get access token
      const accessToken = await this.getAccessToken(clientId, clientSecret);
      if (!accessToken) {
        this.error('Failed to get access token');
        return;
      }

      // Get vehicle data
      const vehicleData = await this.getVehicleData(accessToken);
      if (!vehicleData) {
        this.error('No vehicle data received');
        return;
      }

      // Process `lastSeen` to date, hour, and minute only
      const lastSeenDate = vehicleData.lastSeen ? new Date(vehicleData.lastSeen) : null;
      const lastSeenFormatted = lastSeenDate 
          ? `${lastSeenDate.toISOString().slice(0, 16).replace('T', ' ')}` 
          : "Not Available";

      // Format location for Google Maps
      const formatLocation = (location) => {
        if (!location?.latitude || !location?.longitude) return 'Not Available';
        
        // Format for copying into Google Maps
        const mapsUrl = `${location.latitude},${location.longitude}`;
        
        // Try to get a more readable format with approximate location
        try {
          const lat = parseFloat(location.latitude).toFixed(3);
          const lng = parseFloat(location.longitude).toFixed(3);
          return `${lat}°N, ${lng}°E (${mapsUrl})`;
        } catch (e) {
          return mapsUrl;
        }
      };

      // Get location data
      const locationData = vehicleData.location 
          ? formatLocation(vehicleData.location)
          : "Not Available";

      // Format charging status
      const getChargingStatus = (isCharging, isPluggedIn, chargeLimit) => {
        if (!isPluggedIn) return 'Not Connected';
        if (isCharging) return 'Charging';
        if (chargeLimit && vehicleData.chargeState?.batteryLevel >= chargeLimit) return 'Charge Complete';
        return 'Connected';
      };

      // Format power delivery state
      const formatPowerDelivery = (powerState, isCharging) => {
        if (!isCharging) return 'No Power';
        if (!powerState) return 'Unknown';
        
        // Convert to kW if the value is in watts
        const power = powerState > 1000 ? (powerState / 1000).toFixed(1) : powerState;
        const unit = powerState > 1000 ? 'kW' : 'W';
        
        return `${power} ${unit}`;
      };

      // Extract and set data to capabilities with proper types
      const finalData = {
        batteryLevel: vehicleData.chargeState?.batteryLevel ? `${vehicleData.chargeState.batteryLevel}%` : 'Unknown',
        range: vehicleData.chargeState?.range,
        chargingStatus: getChargingStatus(
          vehicleData.chargeState?.isCharging,
          vehicleData.chargeState?.isPluggedIn,
          vehicleData.chargeState?.chargeLimit
        ),
        pluggedInStatus: vehicleData.chargeState?.isPluggedIn,
        location: locationData,
        lastSeen: lastSeenFormatted,
        odometer: vehicleData.odometer?.distance ? `${vehicleData.odometer.distance} km` : null,
        smartCharging: vehicleData.smartChargingPolicy?.isEnabled,
        chargingLimit: vehicleData.chargeState?.chargeLimit,
        powerDeliveryState: formatPowerDelivery(
          vehicleData.chargeState?.powerDeliveryState,
          vehicleData.chargeState?.isCharging
        ),
        batteryCapacity: vehicleData.chargeState?.batteryCapacity,
        vehicleBrand: vehicleData.information?.brand,
        vehicleModel: vehicleData.information?.model || this.getData().id.toUpperCase(),
        vehicleYear: vehicleData.information?.year,
        vehicleVin: vehicleData.information?.vin
      };

      // Log available capabilities from API
      this.log('Setting vehicle capabilities:', Object.keys(finalData).join(', '));

      // Set each capability
      try {
        await this.setCapabilityValue('batteryLevel', finalData.batteryLevel);
        await this.setCapabilityValue('range', finalData.range);
        await this.setCapabilityValue('chargingStatus', finalData.chargingStatus);
        await this.setCapabilityValue('pluggedInStatus', finalData.pluggedInStatus);
        await this.setCapabilityValue('location', finalData.location);
        await this.setCapabilityValue('lastSeen', finalData.lastSeen);
        await this.setCapabilityValue('odometer', finalData.odometer);
        await this.setCapabilityValue('smartCharging', finalData.smartCharging);
        await this.setCapabilityValue('chargingLimit', finalData.chargingLimit);
        await this.setCapabilityValue('powerDeliveryState', finalData.powerDeliveryState);
        await this.setCapabilityValue('batteryCapacity', finalData.batteryCapacity);
        await this.setCapabilityValue('vehicleBrand', finalData.vehicleBrand);
        await this.setCapabilityValue('vehicleModel', finalData.vehicleModel);
        await this.setCapabilityValue('vehicleYear', finalData.vehicleYear);
        await this.setCapabilityValue('vehicleVin', finalData.vehicleVin);
      } catch (error) {
        this.error('Error setting capabilities:', error);
      }
    } catch (error) {
      if (error.message === 'Rate limit exceeded') {
        this.log('Rate limit reached, will retry on next update interval');
      } else {
        this.error("Error during updateVehicleData execution:", error);
      }
    }
  }

  // Flow action handlers
  async onActionStartCharging() {
    try {
      const accessToken = await this.getAccessToken(this.clientId, this.clientSecret);
      if (!accessToken) {
        throw new Error('Failed to get access token');
      }

      const vehicleData = await this.getVehicleData(accessToken);
      if (!vehicleData) {
        throw new Error('Failed to get vehicle data');
      }

      // Check if the vehicle is plugged in
      if (!vehicleData.chargeState?.isPluggedIn) {
        throw new Error('Vehicle is not plugged in');
      }

      await this.startCharging(accessToken, vehicleData.id);
      await this.updateVehicleData(); // Update vehicle data after charging state change
    } catch (error) {
      this.error('Error in onActionStartCharging:', error);
      throw error;
    }
  }

  async onActionStopCharging() {
    try {
      const accessToken = await this.getAccessToken(this.clientId, this.clientSecret);
      if (!accessToken) {
        throw new Error('Failed to get access token');
      }

      const vehicleData = await this.getVehicleData(accessToken);
      if (!vehicleData) {
        throw new Error('Failed to get vehicle data');
      }

      await this.stopCharging(accessToken, vehicleData.id);
      await this.updateVehicleData(); // Update vehicle data after charging state change
    } catch (error) {
      this.error('Error in onActionStopCharging:', error);
      throw error;
    }
  }

  async onActionSetSmartCharging(args) {
    try {
      const accessToken = await this.getAccessToken(this.clientId, this.clientSecret);
      if (!accessToken) {
        throw new Error('Failed to get access token');
      }

      const vehicleData = await this.getVehicleData(accessToken);
      if (!vehicleData) {
        throw new Error('Failed to get vehicle data');
      }

      // Convert string 'true'/'false' to boolean
      const enabled = args.enabled === 'true';
      await this.setSmartCharging(accessToken, vehicleData.id, enabled);
      await this.updateVehicleData(); // Update vehicle data after smart charging change
    } catch (error) {
      this.error('Error in onActionSetSmartCharging:', error);
      throw error;
    }
  }

  // Device#onSettings to handle changes in settings
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    if (changedKeys.includes('clientId') || changedKeys.includes('clientSecret') || changedKeys.includes('updateInterval')) {
      // Update settings and clear interval if necessary
      clearInterval(this.pollingInterval);
      this.updateInterval = parseInt(newSettings.updateInterval) || 10;
      this.clientId = newSettings.clientId;
      this.clientSecret = newSettings.clientSecret;

      // Restart data fetching with the new interval
      this.pollingInterval = setInterval(() => this.updateVehicleData(), this.updateInterval * 60 * 1000);
      await this.updateVehicleData();
    }
  }

  async onDeleted() {
    clearInterval(this.pollingInterval);
  }
}

module.exports = XpengCarDevice;
