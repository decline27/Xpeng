const Homey = require('homey');
const EnodeAPI = require('../../lib/enode-api');

class XpengCarDevice extends Homey.Device {
  async onInit() {
    this.log('XPeng device has been initialized');
    this.enodeApi = new EnodeAPI(this.homey);

    // Get device data
    const deviceData = this.getData();
    this.vehicleId = deviceData.id;

    // Retrieve settings
    const settings = this.getSettings();
    this.updateInterval = parseInt(settings.updateInterval) || 10;

    // Check if essential data is present
    if (!this.vehicleId || isNaN(this.updateInterval)) {
      this.log("Missing required device data or settings");
      return;
    }

    // Register capabilities
    await this.registerCapabilities();

    // Set up polling interval for vehicle data
    this.pollingInterval = this.homey.setInterval(() => {
      this.pollVehicleData();
    }, this.updateInterval * 60 * 1000); // Poll every updateInterval minutes

    // Initial poll
    await this.pollVehicleData();
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

  async onDeleted() {
    // Clean up polling interval
    if (this.pollingInterval) {
      this.homey.clearInterval(this.pollingInterval);
    }
  }

  async pollVehicleData() {
    try {
      const driver = this.driver;
      const { clientId, clientSecret } = driver.getStoredCredentials();
      
      if (!clientId || !clientSecret) {
        this.error('Missing credentials');
        return;
      }

      const vehicleId = this.getData().id;
      const data = await this.enodeApi.getVehicleData(clientId, clientSecret, vehicleId);

      // Process `lastSeen` to date, hour, and minute only
      const lastSeenDate = data.lastSeen ? new Date(data.lastSeen) : null;
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
      const locationData = data.location 
          ? formatLocation(data.location)
          : "Not Available";

      // Format charging status
      const getChargingStatus = (isCharging, isPluggedIn, chargeLimit) => {
        if (!isPluggedIn) return 'Not Connected';
        if (isCharging) return 'Charging';
        if (chargeLimit && data.chargeState?.batteryLevel >= chargeLimit) return 'Charge Complete';
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
        batteryLevel: data.chargeState?.batteryLevel ? `${data.chargeState.batteryLevel}%` : 'Unknown',
        range: data.chargeState?.range,
        chargingStatus: getChargingStatus(
          data.chargeState?.isCharging,
          data.chargeState?.isPluggedIn,
          data.chargeState?.chargeLimit
        ),
        pluggedInStatus: data.chargeState?.isPluggedIn,
        location: locationData,
        lastSeen: lastSeenFormatted,
        odometer: data.odometer?.distance ? `${data.odometer.distance} km` : null,
        chargingLimit: data.chargeState?.chargeLimit,
        powerDeliveryState: formatPowerDelivery(
          data.chargeState?.powerDeliveryState,
          data.chargeState?.isCharging
        ),
        batteryCapacity: data.chargeState?.batteryCapacity,
        vehicleBrand: data.information?.brand,
        vehicleModel: data.information?.model || this.getData().id.toUpperCase(),
        vehicleYear: data.information?.year,
        vehicleVin: data.information?.vin
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
      this.error('Failed to poll vehicle data:', error);
    }
  }

  async startCharging() {
    try {
      const driver = this.driver;
      const { clientId, clientSecret } = driver.getStoredCredentials();
      
      if (!clientId || !clientSecret) {
        throw new Error('Missing credentials');
      }

      const vehicleId = this.getData().id;
      await this.enodeApi.startCharging(clientId, clientSecret, vehicleId);
      await this.pollVehicleData(); // Update device status
    } catch (error) {
      this.error('Failed to start charging:', error);
      throw error;
    }
  }

  async stopCharging() {
    try {
      const driver = this.driver;
      const { clientId, clientSecret } = driver.getStoredCredentials();
      
      if (!clientId || !clientSecret) {
        throw new Error('Missing credentials');
      }

      const vehicleId = this.getData().id;
      await this.enodeApi.stopCharging(clientId, clientSecret, vehicleId);
      await this.pollVehicleData(); // Update device status
    } catch (error) {
      this.error('Failed to stop charging:', error);
      throw error;
    }
  }

  // Device#onSettings to handle changes in settings
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    if (changedKeys.includes('updateInterval')) {
      // Update settings and clear interval if necessary
      this.homey.clearInterval(this.pollingInterval);
      this.updateInterval = parseInt(newSettings.updateInterval) || 10;

      // Restart data fetching with the new interval
      this.pollingInterval = this.homey.setInterval(() => {
        this.pollVehicleData();
      }, this.updateInterval * 60 * 1000);
      await this.pollVehicleData();
    }
  }
}

module.exports = XpengCarDevice;
