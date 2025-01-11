const Homey = require('homey');
const EnodeAPI = require('../../lib/enode-api');
const VehicleStore = require('../../lib/vehicle-store');

class XpengCarDevice extends Homey.Device {
  async onInit() {
    this.log('XPeng device has been initialized');
    this.enodeApi = new EnodeAPI(this.homey);
    this.vehicleStore = new VehicleStore(this);

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

    // Load stored vehicle data
    await this.vehicleStore.loadStaticData();

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

      // Check if static data needs updating
      if (this.vehicleStore.needsStaticUpdate(data)) {
        await this.vehicleStore.storeStaticData(data);
      }

      // Get static and dynamic data
      const staticData = this.vehicleStore.getStaticData();
      const dynamicData = this.vehicleStore.processDynamicData(data);

      // Combine static and dynamic data
      const finalData = {
        ...staticData,
        ...dynamicData
      };

      // Set capabilities
      try {
        for (const [capability, value] of Object.entries(finalData)) {
          if (value !== undefined && value !== null) {
            await this.setCapabilityValue(capability, value);
          }
        }
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
