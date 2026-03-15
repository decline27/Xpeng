const Homey = require('homey');
const EnodeAPI = require('../../lib/enode-api');
const EnodeOAuth2 = require('../../lib/enode-oauth');
const VehicleStore = require('../../lib/vehicle-store');
const AccountManager = require('../../lib/account-manager');

class XpengCarDevice extends Homey.Device {
  async onInit() {
    // Import ErrorHandler at the top level
    const ErrorHandler = require('../../lib/errorHandler');

    try {
      this.log('XPeng device has been initialized');
      this.enodeApi = new EnodeAPI(this.homey);
      this.vehicleStore = new VehicleStore(this);
      this.accountManager = new AccountManager(this.homey);

      // Get device data and log it for debugging
      const deviceData = this.getData();
      const storeData = this.getStore();
      this.log('Device data:', deviceData);
      this.log('Store data:', {
        hasVehicleInfo: !!storeData.vehicleInfo,
        hasOAuth2TokenData: !!storeData.oAuth2TokenData
      });

      // Store the vehicle ID - check settings first, then device data
      // This allows us to recover if the vehicle ID has changed
      const settings = this.getSettings();
      const storedVehicleId = this.getStoreValue('vehicleId');
      this.vehicleId = settings.vehicleId || storedVehicleId || deviceData.vehicleId || deviceData.id;
      this.log('Initialized with vehicle ID:', this.vehicleId);

      // Default to 10 minutes polling to match Enode's cache timing
      this.updateInterval = parseInt(settings.updateInterval) || 10;

      // Check if essential data is present
      if (!this.vehicleId || isNaN(this.updateInterval)) {
        const configError = new Error("Missing required device data or settings");
        const handled = ErrorHandler.translateError(configError, 'deviceInit');

        this.error(`Configuration error: ${handled.original}`);
        await this.setUnavailable(handled.message);
        return;
      }

      // Initialize OAuth2 client
      const driver = this.driver;
      const { clientId, clientSecret } = driver.getStoredCredentials();

      if (!clientId || !clientSecret) {
        throw new Error('Missing API credentials');
      }

      this.oAuth2Client = new EnodeOAuth2({
        clientId: clientId,
        clientSecret: clientSecret,
        redirectUri: 'https://callback.athom.com/oauth2/callback',
        homey: this.homey,
        logger: this
      });

      // Load OAuth2 token data if available
      if (storeData.oAuth2TokenData) {
        this.oAuth2Client.loadToken(storeData.oAuth2TokenData);
        this.log('Loaded OAuth2 token data from device store');
      }

      // Store the account ID if available
      // Use the existing deviceData variable
      let accountId = this.getStoreValue('accountId');

      // If we have a VIN, check which account it belongs to
      if (deviceData.vin && !accountId) {
        accountId = this.accountManager.getVehicleAccount(deviceData.vin);
        if (accountId) {
          this.log(`Found account ${accountId} for vehicle with VIN ${deviceData.vin}`);
          await this.setStoreValue('accountId', accountId);
        }
      }

      // Verify the vehicle ID with Enode API
      try {
        // Get vehicles from the appropriate account or all accounts
        const vehicles = await this.enodeApi.getVehicles();
        const vehicle = vehicles.find(v => v.id === this.vehicleId);

        if (!vehicle) {
          // Get the VIN from device data (using existing deviceData variable)
          const vin = deviceData.vin;

          // If we have a VIN, try to find the vehicle by VIN
          if (vin) {
            this.log(`Vehicle ID ${this.vehicleId} not found, trying to find by VIN ${vin}`);
            const vehicleByVin = vehicles.find(v => v.information?.vin === vin);

            if (vehicleByVin) {
              // Update the vehicle ID to the new one
              this.log(`Found vehicle with matching VIN but different ID: ${vehicleByVin.id}`);
              this.vehicleId = vehicleByVin.id;

              // Store the updated ID - we can't directly update the data
              // but we can store it in settings and use it from now on
              await this.setSettings({
                vehicleId: vehicleByVin.id
              });

              // Also update the store
              await this.setStoreValue('vehicleId', vehicleByVin.id);

              this.log(`Updated vehicle ID to ${this.vehicleId}`);
              this.log(`Verified vehicle with VIN ${vin} exists in user's account: ${vehicleByVin.information?.brand} ${vehicleByVin.information?.model}`);
              return;
            }
          }

          const notFoundError = new Error(`Vehicle ${this.vehicleId} not found in user's account`);
          const handled = ErrorHandler.translateError(notFoundError, 'vehicleVerification');

          this.error(`Vehicle not found: ${vehicles.map(v => ({ id: v.id, name: v.name }))}`);
          await this.setUnavailable(handled.message);
          return;
        }

        this.log(`Verified vehicle ${this.vehicleId} exists in user's account: ${vehicle.information?.brand} ${vehicle.information?.model}, reachable: ${vehicle.isReachable}`);
      } catch (error) {
        // Handle initialization error with user-friendly message
        const handled = ErrorHandler.translateError(error, 'vehicleVerification');
        this.error('Failed to verify vehicle:', error);
        await this.setUnavailable(`${handled.message} ${handled.suggestion}`);
        return;
      }

      // Register capabilities
      await this.registerCapabilities();

      // Load stored vehicle data
      await this.vehicleStore.loadStaticData();

      // Set up adaptive polling based on vehicle state
      this.setupAdaptivePolling();

      // Set up health check to periodically verify device connectivity
      this.setupHealthCheck();

      // Initial poll
      try {
        await this.pollVehicleData();
      } catch (pollError) {
        // Non-fatal error - log but continue
        const handled = ErrorHandler.translateError(pollError, 'initialPoll');
        this.error(`Initial data poll failed: ${handled.original}`);

        // We can still make the device available, but warn the user
        if (this.homey && this.homey.notifications) {
          this.homey.notifications.createNotification({
            excerpt: `XPENG Car: ${handled.message} ${handled.suggestion}`
          });
        }
      }

      // Set firstConnected timestamp if not already set
      const firstConnected = this.getStoreValue('firstConnected');
      if (!firstConnected) {
        this.setStoreValue('firstConnected', Date.now());
      }

      // Mark device as available
      await this.setAvailable();

    } catch (error) {
      // Handle any uncaught errors during initialization
      const handled = ErrorHandler.translateError(error, 'deviceInit');
      this.error('Failed to initialize device:', error);
      await this.setUnavailable(`${handled.message} ${handled.suggestion}`);
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

  /**
   * Cleanup when device is deleted
   */
  async onDeleted() {
    try {
      // Clean up all intervals and timeouts
      if (this.pollingInterval) {
        this.homey.clearInterval(this.pollingInterval);
        this.pollingInterval = null;
      }

      if (this.shortPollTimeout) {
        this.homey.clearTimeout(this.shortPollTimeout);
        this.shortPollTimeout = null;
      }

      if (this.healthCheckInterval) {
        this.homey.clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }

      // Clean up any cache
      if (this.vehicleStore) {
        this.vehicleStore.clearCache();
      }

      // Log device removal for analytics
      const deviceLifespan = Date.now() - (this.getStoreValue('firstConnected') || Date.now());
      const lifespanDays = Math.round(deviceLifespan / (24 * 60 * 60 * 1000));

      this.log(`Device deleted after ${lifespanDays} days`);
      this.log('Device cleanup completed successfully');
    } catch (error) {
      this.error('Error during device cleanup:', error);
    }
  }

  async pollVehicleData() {
    try {
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

      // Get the account ID for this vehicle
      const accountId = this.getStoreValue('accountId');
      if (accountId) {
        this.log(`Using account ${accountId} for vehicle ${vehicleId}`);
      }

      // Get data with or without refresh
      let data;
      if (useRefresh) {
        data = await this.enodeApi.refreshVehicleData(vehicleId, 2000);
        // Only fallback to getVehicleData if refreshVehicleData returned null
        if (!data) {
          this.log('Refresh failed, using regular vehicle data fetch');
          data = await this.enodeApi.getVehicleData(vehicleId, accountId);
        }
      } else {
        data = await this.enodeApi.getVehicleData(vehicleId, accountId);
      }

      // If we got data and have a VIN but no account ID, store the account mapping
      if (data && data.information?.vin && !accountId) {
        const vin = data.information.vin;
        // If the vehicle has an _accountId property, use it
        if (data._accountId) {
          this.log(`Storing account ${data._accountId} for vehicle with VIN ${vin}`);
          this.accountManager.setVehicleAccount(vin, data._accountId);
          await this.setStoreValue('accountId', data._accountId);
        }
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

      // Store the complete data in cache
      this.vehicleStore.setCachedData({
        batteryLevel: finalData.batteryLevel,
        range: finalData.range,
        chargingStatus: finalData.chargingStatus,
        pluggedInStatus: finalData.pluggedInStatus,
        location: finalData.location,
        lastSeen: finalData.lastSeen,
        powerDeliveryState: finalData.powerDeliveryState,
        vehicleModel: finalData.vehicleModel,
        timestamp: now
      });

      // Update capabilities
      await this.updateCapabilities(finalData);

      // Store updated OAuth2 token data if available
      if (this.oAuth2Client) {
        const tokenData = this.oAuth2Client.getTokenData();
        if (tokenData) {
          await this.setStoreValue('oAuth2TokenData', tokenData);
          this.log('Updated OAuth2 token data in device store');
        }
      }

      return true;
    } catch (error) {
      this.error('Failed to poll vehicle data:', error);
      throw error;
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
      // Set capabilities
      let updatedCapabilities = 0;
      const failedCapabilities = [];
      const changedCapabilities = new Map();
      const oldValues = {};

      // Log the processed capability data for debugging
      this.log('Processing charge state:', {
        isPluggedIn: data.pluggedInStatus,
        isCharging: data.chargingStatus,
        batteryLevel: data.batteryLevel,
        chargeLimit: data.chargingLimit
      });

      // First, store old values for comparison
      for (const capability of Object.keys(data)) {
        if (data[capability] !== undefined && data[capability] !== null) {
          oldValues[capability] = this.getCapabilityValue(capability);
        }
      }

      // Then update capabilities
      for (const [capability, value] of Object.entries(data)) {
        if (value !== undefined && value !== null) {
          try {
            const oldValue = oldValues[capability];

            // Special handling for pluggedInStatus
            if (capability === 'pluggedInStatus') {
              // Ensure we have boolean values
              const oldBool = oldValue === true;
              const newBool = value === true;

              // Apply the value as boolean
              await this.setCapabilityValue(capability, newBool);
              updatedCapabilities++;

              this.log(`Processing pluggedInStatus: ${oldBool} => ${newBool}`);

              // Only store changes if the boolean interpretation changes
              if (oldBool !== newBool) {
                this.log(`Plugged in status changed from ${oldBool} to ${newBool} (will trigger flow)`);
                changedCapabilities.set(capability, { oldValue: oldBool, newValue: newBool });
              }
            }
            // Handle other capabilities normally with Insights support
            else {
              // Use specialized methods for key metrics to ensure Insights logging
              if (capability === 'batteryLevel') {
                await this.updateBatteryLevel(value);
              } else if (capability === 'range') {
                await this.updateRange(value);
              } else if (capability === 'odometer') {
                await this.updateOdometer(value);
              } else if (capability === 'batteryCapacity') {
                await this.updateBatteryCapacity(value);
              } else if (capability === 'chargingLimit') {
                await this.updateChargingLimit(value);
              } else if (capability === 'lastSeen') {
                await this.updateLastSeen(value);
              } else {
                await this.setCapabilityValue(capability, value);
              }
              updatedCapabilities++;

              // Store capability changes for flow triggers
              if (oldValue !== value) {
                changedCapabilities.set(capability, { oldValue, newValue: value });
              }
            }
          } catch (error) {
            failedCapabilities.push(capability);
            this.error(`Failed to set capability ${capability}:`, error.message);
          }
        }
      }

      // Handle flow triggers based on capability changes
      await this.handleFlowTriggers(changedCapabilities);

      this.log(`Updated ${updatedCapabilities} capabilities successfully`);
      if (failedCapabilities.length > 0) {
        this.error(`Failed to update capabilities: ${failedCapabilities.join(', ')}`);
      }

      // If we successfully got data, device is available
      await this.setAvailable();

    } catch (error) {
      this.error('Failed to update capabilities:', error);
    }
  }

  /**
   * Handle flow triggers based on capability changes
   * @param {Map} changedCapabilities - Map of changed capabilities with old and new values
   */
  async handleFlowTriggers(changedCapabilities) {
    try {
      // Battery level changed
      if (changedCapabilities.has('batteryLevel')) {
        const { newValue } = changedCapabilities.get('batteryLevel');
        // batteryLevel is now a numeric value
        const numericValue = typeof newValue === 'number' ? newValue : parseFloat(newValue);
        if (!isNaN(numericValue)) {
          this.log(`Triggering battery_level_changed flow: ${numericValue}%`);
          await this.homey.flow.getDeviceTriggerCard('battery_level_changed')
            .trigger(this, { battery_level: numericValue });

          // Trigger battery_low - the run listener in driver.js filters by user threshold
          await this.homey.flow.getDeviceTriggerCard('battery_low')
            .trigger(this, { battery_level: numericValue });
        }
      }

      // Range changed
      if (changedCapabilities.has('range')) {
        const { newValue } = changedCapabilities.get('range');
        // Extract numeric value from range string (e.g., "300 km")
        const numericValue = parseInt(newValue, 10);
        if (!isNaN(numericValue)) {
          // Trigger range_low - the run listener in driver.js filters by user threshold
          await this.homey.flow.getDeviceTriggerCard('range_low')
            .trigger(this, { range: numericValue });
        }
      }

      // Charging status changed
      if (changedCapabilities.has('chargingStatus')) {
        const { oldValue, newValue } = changedCapabilities.get('chargingStatus');
        this.log(`Charging status changed from ${oldValue} to ${newValue}`);

        // Trigger general status changed flow
        await this.homey.flow.getDeviceTriggerCard('charging_status_changed')
          .trigger(this, {
            status: newValue || 'Unknown',
            previous_status: oldValue || 'Unknown',
            current_status: newValue || 'Unknown'  // Add this for backward compatibility
          });

        // Handle specific charging state changes
        if (newValue === 'Charging' && oldValue !== 'Charging') {
          this.log('Triggering charging_started flow');
          await this.homey.flow.getDeviceTriggerCard('charging_started')
            .trigger(this);
        } else if (oldValue === 'Charging' && newValue !== 'Charging') {
          this.log('Triggering charging_stopped flow');
          await this.homey.flow.getDeviceTriggerCard('charging_stopped')
            .trigger(this);
        }
      }

      // Plugged in status changed
      if (changedCapabilities.has('pluggedInStatus')) {
        const { oldValue, newValue } = changedCapabilities.get('pluggedInStatus');
        this.log(`Plugged in status changed from ${oldValue} to ${newValue}`);

        // Check the type of values and log them for debugging
        this.log('Value types:', {
          oldValueType: typeof oldValue,
          newValueType: typeof newValue,
          oldValue: String(oldValue),
          newValue: String(newValue)
        });

        if (newValue === true && oldValue !== true) {
          this.log('Triggering plugged_in flow');
          try {
            const triggerCard = this.homey.flow.getDeviceTriggerCard('plugged_in');
            this.log('Trigger card found:', !!triggerCard);

            // Make sure we're passing the device correctly
            this.log('Device info:', {
              id: this.id,
              name: this.getName(),
              hasCapabilities: !!this.hasCapability
            });

            await triggerCard.trigger(this);
            this.log('Plugged in trigger completed successfully');
          } catch (triggerError) {
            this.error('Error triggering plugged_in flow:', triggerError);
          }
        } else if (newValue === false && oldValue !== false) {
          this.log('Triggering unplugged flow');
          try {
            await this.homey.flow.getDeviceTriggerCard('unplugged')
              .trigger(this);
            this.log('Unplugged trigger completed successfully');
          } catch (triggerError) {
            this.error('Error triggering unplugged flow:', triggerError);
          }
        }
      }

      // Location changed
      if (changedCapabilities.has('location')) {
        const { newValue } = changedCapabilities.get('location');
        this.log(`Location changed to ${newValue}`);

        // Extract coordinates for distance calculation if available
        let distance = 0;
        if (newValue && typeof newValue === 'string') {
          const coordMatch = newValue.match(/\(([^,]+),([^)]+)\)/);
          if (coordMatch && coordMatch.length >= 3) {
            // Just set a placeholder distance for now
            distance = 0.1; // 100 meters as placeholder
          }
        }

        await this.homey.flow.getDeviceTriggerCard('location_changed')
          .trigger(this, {
            location: newValue || 'Unknown',
            distance: distance
          });
      }

    } catch (error) {
      this.error('Failed to handle flow triggers:', error);
    }
  }

  async startCharging() {
    try {
      // Use the stored vehicle ID
      const vehicleId = this.vehicleId;
      if (!vehicleId) {
        throw new Error('Missing vehicle ID');
      }

      // Get the account ID for this vehicle
      const accountId = this.getStoreValue('accountId');
      if (accountId) {
        this.log(`Starting charging for vehicle ${vehicleId} using account ${accountId}`);
      } else {
        this.log('Starting charging for vehicle:', vehicleId);
      }

      await this.enodeApi.startCharging(vehicleId);
      await this.pollVehicleData(); // Update device status
    } catch (error) {
      // Use the ErrorHandler to handle and format the error
      const ErrorHandler = require('../../lib/errorHandler');

      // Create a reporter function to display errors to the user (if possible)
      const reporter = (translatedError) => {
        // Show in device activity log if available
        if (this.homey && this.homey.notifications) {
          this.homey.notifications.createNotification({
            excerpt: ErrorHandler.formatErrorMessage(translatedError)
          });
        }
      };

      // Handle the error with context
      const handled = ErrorHandler.handleError(
        error,
        'startCharging',
        reporter
      );

      // Log additional context (useful for troubleshooting)
      this.error(`Failed to start charging for ${this.getName()}: ${handled.original}`);

      // Rethrow with user-friendly message
      throw new Error(`${handled.message} ${handled.suggestion}`);
    }
  }

  async stopCharging() {
    try {
      // Use the stored vehicle ID
      const vehicleId = this.vehicleId;
      if (!vehicleId) {
        throw new Error('Missing vehicle ID');
      }

      // Get the account ID for this vehicle
      const accountId = this.getStoreValue('accountId');
      if (accountId) {
        this.log(`Stopping charging for vehicle ${vehicleId} using account ${accountId}`);
      } else {
        this.log('Stopping charging for vehicle:', vehicleId);
      }

      await this.enodeApi.stopCharging(vehicleId);
      await this.pollVehicleData(); // Update device status
    } catch (error) {
      // Use the ErrorHandler to handle and format the error
      const ErrorHandler = require('../../lib/errorHandler');

      // Create a reporter function to display errors to the user (if possible)
      const reporter = (translatedError) => {
        // Show in device activity log if available
        if (this.homey && this.homey.notifications) {
          this.homey.notifications.createNotification({
            excerpt: ErrorHandler.formatErrorMessage(translatedError)
          });
        }
      };

      // Handle the error with context
      const handled = ErrorHandler.handleError(
        error,
        'stopCharging',
        reporter
      );

      // Log additional context
      this.error(`Failed to stop charging for ${this.getName()}: ${handled.original}`);

      // Rethrow with user-friendly message
      throw new Error(`${handled.message} ${handled.suggestion}`);
    }
  }

  // Add method to force immediate refresh
  async refreshData() {
    try {
      await this.pollVehicleData();
      return true;
    } catch (error) {
      // Use the ErrorHandler to handle and format the error
      const ErrorHandler = require('../../lib/errorHandler');

      // Create a reporter function to display errors to the user (if possible)
      const reporter = (translatedError) => {
        // For refresh errors, we can use a different notification mechanism
        // since this is less critical than charging errors
        if (this.homey && this.homey.notifications) {
          this.homey.notifications.createNotification({
            excerpt: `Data refresh: ${ErrorHandler.formatErrorMessage(translatedError)}`,
            options: { excerpt: { containsHtml: false } }
          });
        }
      };

      // Handle the error but don't rethrow (non-critical operation)
      const handled = ErrorHandler.handleError(
        error,
        'refreshData',
        reporter,
        false // don't rethrow
      );

      this.error(`Failed to refresh data for ${this.getName()}: ${handled.original}`);
      return false;
    }
  }

  // Step 1: Specialized methods for Insights logging
  async updateBatteryLevel(batteryValue) {
    try {
      await this.setCapabilityValue('batteryLevel', batteryValue);
      // Insights will automatically log this if enabled (preventInsights: false)
      this.log(`Battery level updated to ${batteryValue} - logged to Insights`);
    } catch (error) {
      this.error('Failed to update battery level:', error);
      throw error;
    }
  }

  async updateRange(rangeValue) {
    try {
      await this.setCapabilityValue('range', rangeValue);
      // Insights will automatically log this if enabled
      this.log(`Range updated to ${rangeValue} - logged to Insights`);
    } catch (error) {
      this.error('Failed to update range:', error);
      throw error;
    }
  }

  async updateOdometer(odometerValue) {
    try {
      await this.setCapabilityValue('odometer', odometerValue);
      // Insights will automatically log this if enabled
      this.log(`Odometer updated to ${odometerValue} - logged to Insights`);
    } catch (error) {
      this.error('Failed to update odometer:', error);
      throw error;
    }
  }

  async updateBatteryCapacity(capacityValue) {
    try {
      await this.setCapabilityValue('batteryCapacity', capacityValue);
      // Insights will automatically log this if enabled
      this.log(`Battery capacity updated to ${capacityValue} - logged to Insights`);
    } catch (error) {
      this.error('Failed to update battery capacity:', error);
      throw error;
    }
  }

  async updateChargingLimit(limitValue) {
    try {
      await this.setCapabilityValue('chargingLimit', limitValue);
      // Insights will automatically log this if enabled
      this.log(`Charging limit updated to ${limitValue} - logged to Insights`);
    } catch (error) {
      this.error('Failed to update charging limit:', error);
      throw error;
    }
  }

  async updatePluggedInStatus(pluggedValue) {
    try {
      await this.setCapabilityValue('pluggedInStatus', pluggedValue);
      // Insights will automatically log this if enabled
      this.log(`Plugged in status updated to ${pluggedValue} - logged to Insights`);
    } catch (error) {
      this.error('Failed to update plugged in status:', error);
      throw error;
    }
  }

  async updateLastSeen(lastSeenValue) {
    try {
      await this.setCapabilityValue('lastSeen', lastSeenValue);
      // Insights will automatically log this if enabled
      this.log(`Last seen updated to ${lastSeenValue} - logged to Insights`);
    } catch (error) {
      this.error('Failed to update last seen:', error);
      throw error;
    }
  }

  // Step 2: Energy Tracking for Homey Energy integration
  getEnergy() {
    try {
      const powerDeliveryState = this.getCapabilityValue('powerDeliveryState') || 0;
      const chargingStatus = this.getCapabilityValue('chargingStatus');
      
      // Convert power delivery state to watts
      // powerDeliveryState is typically in kW, convert to watts
      let watts = 0;
      if (chargingStatus === 'Charging' && powerDeliveryState > 0) {
        watts = powerDeliveryState * 1000; // Convert kW to watts
      }
      
      this.log(`Energy tracking - Power: ${watts}W, Status: ${chargingStatus}`);
      
      return {
        type: 'car',
        watts: watts
      };
    } catch (error) {
      this.error('Failed to get energy data:', error);
      return {
        type: 'car',
        watts: 0
      };
    }
  }

  setEnergy(options) {
    try {
      // Handle setting energy-related states if needed
      // This method is called by Homey Energy when energy settings change
      this.log('Energy options updated:', options);
      
      // Store energy-related settings if provided
      if (options && typeof options === 'object') {
        // Could store energy preferences or settings here
        this.log('Processing energy settings update');
      }
    } catch (error) {
      this.error('Failed to set energy options:', error);
    }
  }

  // Step 3: Predictive Features using Insights data
  async predictRange() {
    try {
      // Get historical battery level and range data from Insights
      const batteryLogs = await this.homey.insights.getLogs({
        uri: `homey:device:${this.getData().id}`,
        capability: 'batteryLevel',
        resolution: 'lastHour',
        start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        end: new Date()
      });
      
      const rangeLogs = await this.homey.insights.getLogs({
        uri: `homey:device:${this.getData().id}`,
        capability: 'range',
        resolution: 'lastHour',
        start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        end: new Date()
      });
      
      if (!batteryLogs || !rangeLogs || batteryLogs.length < 2 || rangeLogs.length < 2) {
        this.log('Insufficient data for range prediction');
        return this.getCapabilityValue('range'); // Return current range as fallback
      }
      
      // Calculate average efficiency (range per battery percentage)
      let totalEfficiency = 0;
      let validSamples = 0;
      
      for (let i = 1; i < Math.min(batteryLogs.length, rangeLogs.length); i++) {
        const batteryDiff = batteryLogs[i].v - batteryLogs[i-1].v;
        const rangeDiff = rangeLogs[i].v - rangeLogs[i-1].v;
        
        if (batteryDiff !== 0) {
          const efficiency = Math.abs(rangeDiff / batteryDiff);
          if (efficiency > 0 && efficiency < 10) { // Sanity check
            totalEfficiency += efficiency;
            validSamples++;
          }
        }
      }
      
      if (validSamples === 0) {
        this.log('No valid efficiency samples for prediction');
        return this.getCapabilityValue('range');
      }
      
      const avgEfficiency = totalEfficiency / validSamples;
      const currentBattery = this.getCapabilityValue('batteryLevel') || 0;
      const predictedRange = Math.round(currentBattery * avgEfficiency);
      
      this.log(`Range prediction: ${predictedRange} km (efficiency: ${avgEfficiency.toFixed(2)} km/%, battery: ${currentBattery}%)`);
      
      return predictedRange;
    } catch (error) {
      this.error('Failed to predict range:', error);
      return this.getCapabilityValue('range') || 0;
    }
  }

  async predictChargingTime() {
    try {
      const currentBattery = this.getCapabilityValue('batteryLevel') || 0;
      const chargingLimit = this.getCapabilityValue('chargingLimit') || 100;
      const powerDeliveryState = this.getCapabilityValue('powerDeliveryState') || 0;
      const batteryCapacity = this.getCapabilityValue('batteryCapacity') || 100;
      
      if (powerDeliveryState <= 0 || currentBattery >= chargingLimit) {
        return 0; // Not charging or already at limit
      }
      
      // Calculate remaining capacity to charge
      const remainingPercent = chargingLimit - currentBattery;
      const remainingCapacity = (remainingPercent / 100) * batteryCapacity; // kWh
      
      // Estimate charging time in hours
      const chargingTimeHours = remainingCapacity / powerDeliveryState;
      const chargingTimeMinutes = Math.round(chargingTimeHours * 60);
      
      this.log(`Charging time prediction: ${chargingTimeMinutes} minutes (${remainingPercent}% remaining, ${powerDeliveryState}kW power)`);
      
      return chargingTimeMinutes;
    } catch (error) {
      this.error('Failed to predict charging time:', error);
      return 0;
    }
  }

  // Set up adaptive polling intervals based on vehicle state
  setupAdaptivePolling() {
    // Clear any existing polling and short poll timeout
    if (this.pollingInterval) {
      this.homey.clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    if (this.shortPollTimeout) {
      this.homey.clearTimeout(this.shortPollTimeout);
      this.shortPollTimeout = null;
    }

    // Get current settings
    const settings = this.getSettings();
    this.updateInterval = parseInt(settings.updateInterval) || 10;

    // Set the base polling interval (minimum 10 minutes by default)
    const baseInterval = Math.max(10, this.updateInterval) * 60 * 1000;

    // Create adaptive polling function
    this.pollingInterval = this.homey.setInterval(async () => {
      try {
        // Check vehicle state to determine if we need more frequent polling
        const isCharging = this.getCapabilityValue('chargingStatus') === 'Charging';

        // If vehicle is charging, we'll poll again sooner (half the regular interval)
        if (isCharging) {
          this.log('Vehicle is charging - scheduling next poll sooner');
          // Cancel the regular interval temporarily
          this.homey.clearInterval(this.pollingInterval);
          this.pollingInterval = null;

          // Poll once after a shorter delay
          this.shortPollTimeout = this.homey.setTimeout(async () => {
            try {
              await this.pollVehicleData();
            } catch (error) {
              this.error('Error polling during charging:', error);
            }
            // Resume normal polling regardless of poll success/failure
            this.setupAdaptivePolling();
          }, Math.min(baseInterval / 2, 5 * 60 * 1000)); // Min of half time or 5 minutes

          // Make sure the timeout doesn't keep the Node.js process alive (for testing)
          if (this.shortPollTimeout.unref && typeof this.shortPollTimeout.unref === 'function') {
            this.shortPollTimeout.unref();
          }

          return; // Exit early since we've scheduled the next poll
        }

        // Regular polling
        await this.pollVehicleData();
      } catch (error) {
        this.error('Error in adaptive polling:', error);
        // Still try to poll on the next scheduled interval
      }
    }, baseInterval);

    // Make sure the interval doesn't keep the Node.js process alive (for testing)
    if (this.pollingInterval.unref && typeof this.pollingInterval.unref === 'function') {
      this.pollingInterval.unref();
    }
  }

  /**
   * Set up a periodic health check to verify device connectivity
   * This helps detect issues with the vehicle connection before users notice
   */
  setupHealthCheck() {
    // Clear any existing health check
    if (this.healthCheckInterval) {
      this.homey.clearInterval(this.healthCheckInterval);
    }

    // Set up daily health check (every 24 hours)
    const HEALTH_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

    this.healthCheckInterval = this.homey.setInterval(async () => {
      try {
        this.log('Running periodic health check');

        // Check if we've received data recently (within double the polling interval)
        const lastDataUpdate = this.getStoreValue('lastDataUpdate') || 0;
        const now = Date.now();
        const maxSilence = Math.max(20, this.updateInterval * 2) * 60 * 1000; // At least 20 minutes

        if (now - lastDataUpdate > maxSilence) {
          this.log(`Health check: No data received since ${new Date(lastDataUpdate).toISOString()}`);

          // Try to refresh data
          const success = await this.refreshData();

          if (!success) {
            // If refresh fails, notify user about potential connection issue
            const ErrorHandler = require('../../lib/errorHandler');
            const error = new Error('Vehicle connection may be interrupted');
            const handled = ErrorHandler.translateError(error, 'healthCheck');

            if (this.homey && this.homey.notifications) {
              this.homey.notifications.createNotification({
                excerpt: `XPENG Car Health Check: ${handled.message} ${handled.suggestion}`
              });
            }
          }
        } else {
          this.log('Health check: Connection is good');
        }

        // Record health check
        this.setStoreValue('lastHealthCheck', now);
      } catch (error) {
        this.error('Error in health check:', error);
      }
    }, HEALTH_CHECK_INTERVAL);

    // Make sure interval doesn't keep process alive
    if (this.healthCheckInterval.unref && typeof this.healthCheckInterval.unref === 'function') {
      this.healthCheckInterval.unref();
    }
  }

  // Device#onSettings to handle changes in settings
  async onSettings({ oldSettings, newSettings, changedKeys }) {
    if (changedKeys.includes('updateInterval')) {
      // Update settings and reconfigure adaptive polling
      this.updateInterval = parseInt(newSettings.updateInterval) || 10;
      this.setupAdaptivePolling();

      // Update health check as polling interval has changed
      this.setupHealthCheck();

      // Do an immediate poll with the new settings
      await this.pollVehicleData();
    }
  }
}

module.exports = XpengCarDevice;
