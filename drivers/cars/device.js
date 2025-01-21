const Homey = require('homey');
const EnodeAPI = require('../../lib/enode-api');
const VehicleStore = require('../../lib/vehicle-store');

class XpengCarDevice extends Homey.Device {
  async onInit() {
    try {
      this.log('XPeng device has been initialized');
      this.enodeApi = new EnodeAPI(this.homey);
      this.vehicleStore = new VehicleStore(this);

      // Get device data and log it for debugging
      const deviceData = this.getData();
      this.log('Device data:', deviceData);
      
      // Store the vehicle ID
      this.vehicleId = deviceData.vehicleId || deviceData.id;
      this.log('Initialized with vehicle ID:', this.vehicleId);

      // Retrieve settings
      const settings = this.getSettings();
      // Default to 10 minutes polling to match Enode's cache timing
      this.updateInterval = parseInt(settings.updateInterval) || 10;

      // Check if essential data is present
      if (!this.vehicleId || isNaN(this.updateInterval)) {
        this.error("Missing required device data or settings");
        await this.setUnavailable("Missing required device data or settings");
        return;
      }

      // Verify the vehicle ID with Enode API
      try {
        const driver = this.driver;
        const { clientId, clientSecret } = driver.getStoredCredentials();
        
        if (!clientId || !clientSecret) {
          throw new Error('Missing API credentials');
        }

        const vehicles = await this.enodeApi.getVehicles(clientId, clientSecret);
        const vehicle = vehicles.find(v => v.id === this.vehicleId);
        
        if (!vehicle) {
          this.error(`Vehicle ${this.vehicleId} not found in user's account. Available vehicles:`, 
            vehicles.map(v => ({ id: v.id, name: v.name }))
          );
          await this.setUnavailable("Vehicle not found in user's account");
          return;
        }

        this.log(`Verified vehicle ${this.vehicleId} exists in user's account:`, vehicle);
      } catch (error) {
        this.error('Failed to verify vehicle:', error);
        await this.setUnavailable("Failed to verify vehicle: " + error.message);
        return;
      }

      // Register capabilities
      await this.registerCapabilities();

      // Load stored vehicle data
      await this.vehicleStore.loadStaticData();

      // Set up polling interval for vehicle data
      // Use longer interval for regular polling to protect battery
      this.pollingInterval = this.homey.setInterval(() => {
        this.pollVehicleData();
      }, Math.max(10, this.updateInterval) * 60 * 1000); // Minimum 10 minutes

      // Initial poll
      await this.pollVehicleData();

      // Mark device as available
      await this.setAvailable();
    } catch (error) {
      this.error('Failed to initialize device:', error);
      await this.setUnavailable("Failed to initialize: " + error.message);
    }
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
      if (!driver) {
        throw new Error('Driver not initialized');
      }

      const { clientId, clientSecret } = driver.getStoredCredentials();
      if (!clientId || !clientSecret) {
        throw new Error('Missing API credentials');
      }

      // Use the stored vehicle ID
      const vehicleId = this.vehicleId;
      if (!vehicleId) {
        throw new Error('Missing vehicle ID');
      }

      this.log('Polling data for vehicle:', vehicleId);

      // Only use refresh-hint if:
      // 1. Car is charging (we want accurate charging status)
      // 2. Car was recently unplugged (catch status changes)
      // 3. We haven't gotten data in a while (>30 min)
      let useRefresh = false;
      const lastDataUpdate = this.getStoreValue('lastDataUpdate');
      const isCharging = this.getCapabilityValue('chargingStatus');
      const wasPluggedIn = this.getStoreValue('wasPluggedIn');
      const now = Date.now();

      if (isCharging || 
          (wasPluggedIn && !this.getCapabilityValue('pluggedInStatus')) ||
          !lastDataUpdate || 
          (now - lastDataUpdate > 30 * 60 * 1000)) {
        useRefresh = true;
      }

      // Get data with or without refresh
      let data;
      if (useRefresh) {
        data = await this.enodeApi.refreshVehicleData(clientId, clientSecret, vehicleId, 2000);
      } else {
        data = await this.enodeApi.getVehicleData(clientId, clientSecret, vehicleId);
      }

      if (!data) {
        throw new Error('No data received from API');
      }

      // Store current plugged in status for next comparison
      this.setStoreValue('wasPluggedIn', data.chargeState?.isPluggedIn || false);
      this.setStoreValue('lastDataUpdate', now);

      // Check if static data needs updating
      if (this.vehicleStore.needsStaticUpdate(data)) {
        await this.vehicleStore.storeStaticData(data);
      }

      // Get static and dynamic data
      const staticData = this.vehicleStore.getStaticData();
      const dynamicData = this.vehicleStore.processDynamicData(data);

      if (!staticData || !dynamicData) {
        throw new Error('Failed to process vehicle data');
      }

      // Combine static and dynamic data
      const finalData = {
        ...staticData,
        ...dynamicData
      };

      // Set capabilities
      let updatedCapabilities = 0;
      const failedCapabilities = [];

      // Log the charge state for debugging
      this.log('Processing charge state:', {
        isPluggedIn: data.chargeState?.isPluggedIn,
        isCharging: data.chargeState?.isCharging,
        batteryLevel: data.chargeState?.batteryLevel,
        chargeLimit: data.chargeState?.chargeLimit
      });

      for (const [capability, value] of Object.entries(finalData)) {
        if (value !== undefined && value !== null) {
          try {
            await this.setCapabilityValue(capability, value);
            updatedCapabilities++;
          } catch (error) {
            failedCapabilities.push(capability);
            this.error(`Failed to set capability ${capability}:`, error.message);
          }
        }
      }

      this.log(`Updated ${updatedCapabilities} capabilities successfully`);
      if (failedCapabilities.length > 0) {
        this.error(`Failed to update capabilities: ${failedCapabilities.join(', ')}`);
      }

      // If we successfully got data, device is available
      await this.setAvailable();

    } catch (error) {
      this.error('Failed to poll vehicle data:', error.message);
      // Set device unavailable if we have critical errors
      if (error.message.includes('Missing API credentials') || 
          error.message.includes('Missing vehicle ID') ||
          error.message.includes('Driver not initialized')) {
        await this.setUnavailable(error.message);
      }
    }
  }

  async startCharging() {
    try {
      const driver = this.driver;
      const { clientId, clientSecret } = driver.getStoredCredentials();
      
      if (!clientId || !clientSecret) {
        throw new Error('Missing credentials');
      }

      // Use the stored vehicle ID
      const vehicleId = this.vehicleId;
      if (!vehicleId) {
        throw new Error('Missing vehicle ID');
      }

      this.log('Starting charging for vehicle:', vehicleId);
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

      // Use the stored vehicle ID
      const vehicleId = this.vehicleId;
      if (!vehicleId) {
        throw new Error('Missing vehicle ID');
      }

      this.log('Stopping charging for vehicle:', vehicleId);
      await this.enodeApi.stopCharging(clientId, clientSecret, vehicleId);
      await this.pollVehicleData(); // Update device status
    } catch (error) {
      this.error('Failed to stop charging:', error);
      throw error;
    }
  }

  // Add method to force immediate refresh
  async refreshData() {
    try {
      await this.pollVehicleData();
      return true;
    } catch (error) {
      this.error('Failed to refresh data:', error);
      return false;
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
      }, Math.max(10, this.updateInterval) * 60 * 1000);
      await this.pollVehicleData();
    }
  }
}

module.exports = XpengCarDevice;
