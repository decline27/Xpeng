const Homey = require('homey');
const EnodeAPI = require('../../lib/enode-api');
const VehicleStore = require('../../lib/vehicle-store');
const LocationService = require('../../lib/location-service');

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
      const { clientId, clientSecret } = this.driver.getStoredCredentials();
      if (!clientId || !clientSecret) {
        throw new Error('Missing API credentials');
      }

      let data;
      let usedCache = false;

      // First try to get regular data
      try {
        data = await this.enodeApi.getVehicleData(clientId, clientSecret, this.vehicleId);
      } catch (error) {
        this.log('Regular data fetch failed:', error.message);
      }

      // If no data and should refresh, try refresh
      if (!data && this.shouldRefreshData()) {
        try {
          data = await this.enodeApi.refreshVehicleData(
            clientId, 
            clientSecret, 
            this.vehicleId, 
            2000
          );
        } catch (error) {
          if (error.code === 429) {
            this.log('Rate limit hit for refresh-hint, will use cache');
          } else {
            this.error('Refresh attempt failed:', error.message);
          }
        }
      }

      // If still no data, try cache
      if (!data) {
        data = this.vehicleStore.getCachedData();
        if (data && this.vehicleStore.isCacheValid()) {
          this.log('Using valid cached data');
          usedCache = true;
        } else if (data) {
          this.log('Using stale cached data as last resort');
          usedCache = true;
        } else {
          this.log('No cached data available');
          return false;
        }
      }

      // Update device state
      const finalData = {
        ...this.vehicleStore.getStaticData(),
        ...this.vehicleStore.processDynamicData(data)
      };

      // Only update cache if we got fresh data
      if (!usedCache) {
        await this.vehicleStore.setCachedData(finalData);
      }

      // Update capabilities
      await this.updateCapabilities(finalData);

      return true;
    } catch (error) {
      this.error('Error in pollVehicleData:', error.message);
      
      // Last resort - try to use any cached data
      const cachedData = this.vehicleStore.getCachedData();
      if (cachedData) {
        this.log('Using cached data after error');
        await this.updateCapabilities(cachedData);
        return true;
      }
      
      return false;
    }
  }

  async getCachedVehicleData() {
    try {
      const cachedData = this.vehicleStore.getCachedData();
      if (!cachedData) {
        // If no cached data, force a poll
        await this.pollVehicleData();
        return this.vehicleStore.getCachedData();
      }
      return cachedData;
    } catch (error) {
      this.error('Failed to get cached vehicle data:', error);
      throw error;
    }
  }

  async updateCapabilities(data) {
    try {
      // Store previous values for comparison
      const prevBatteryLevel = this.getCapabilityValue('batteryLevel');
      const prevChargingStatus = this.getCapabilityValue('chargingStatus');
      const prevPluggedStatus = this.getCapabilityValue('pluggedInStatus');
      const prevLocation = this.getCapabilityValue('location');
      const prevRange = this.getCapabilityValue('range');

      // Update capabilities with new values
      await this.setCapabilityValue('batteryLevel', data.batteryLevel);
      await this.setCapabilityValue('range', data.range);
      await this.setCapabilityValue('chargingStatus', data.chargingStatus);
      await this.setCapabilityValue('pluggedInStatus', data.pluggedInStatus);
      await this.setCapabilityValue('location', data.location);
      // ... other capability updates ...

      // Trigger flow cards based on changes
      const driver = this.driver;

      // Battery level changes
      if (prevBatteryLevel !== data.batteryLevel) {
        await driver.batteryLevelChangedTrigger.trigger(this, {
          battery_level: data.batteryLevel
        });

        // Check for low battery
        if (data.batteryLevel < 20) {
          await driver.batteryLowTrigger.trigger(this, {
            battery_level: data.batteryLevel
          });
        }
      }

      // Charging status changes
      if (prevChargingStatus !== data.chargingStatus) {
        if (data.chargingStatus) {
          await driver.chargingStartedTrigger.trigger(this);
        } else {
          await driver.chargingStoppedTrigger.trigger(this);
        }
        
        await driver.chargingStatusChangedTrigger.trigger(this, {
          status: data.chargingStatus ? 'charging' : 'not_charging'
        });
      }

      // Plugged status changes
      if (prevPluggedStatus !== data.pluggedInStatus) {
        if (data.pluggedInStatus) {
          await driver.pluggedInTrigger.trigger(this);
        } else {
          await driver.unpluggedTrigger.trigger(this);
        }
      }

      // Location changes
      if (prevLocation !== data.location) {
        await this.handleLocationChange(data.location, prevLocation);
      }

      // Range changes
      if (prevRange !== data.range && data.range < 50) {
        await driver.rangeLowTrigger.trigger(this, {
          range: data.range
        });
      }

    } catch (error) {
      this.error('Error updating capabilities:', error);
      throw error;
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

  async handleLocationChange(newLocation, prevLocation) {
    try {
      if (!newLocation) return;
      
      // Convert coordinates to address
      const address = await LocationService.getAddressFromCoordinates(
        newLocation.latitude,
        newLocation.longitude
      );

      const locationData = {
        location: address,
        formattedAddress: address
      };

      // Trigger the location change event
      await this.driver.whenLocationTrigger.trigger(this, locationData);
      
      // Store the address for condition checking
      await this.setStoreValue('lastAddress', address);
    } catch (error) {
      this.error('Failed to handle location change:', error);
    }
  }

  // Method to check if car is at specific address
  async isAtAddress(targetAddress) {
    try {
      const currentLocation = await this.getLocation();
      if (!currentLocation) return false;

      const currentAddress = await LocationService.getAddressFromCoordinates(
        currentLocation.latitude,
        currentLocation.longitude
      );

      // Simple string comparison (you might want to implement more sophisticated matching)
      return currentAddress.toLowerCase().includes(targetAddress.toLowerCase());
    } catch (error) {
      this.error('Failed to check address:', error);
      return false;
    }
  }
}

module.exports = XpengCarDevice;
