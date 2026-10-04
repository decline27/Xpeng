const Homey = require('homey');
const EnodeAPI = require('../../lib/enode-api');
const EnodeOAuth2 = require('../../lib/enode-oauth');
const VehicleStore = require('../../lib/vehicle-store');
const AccountManager = require('../../lib/account-manager');
const { shouldUseRefreshHint, nextPollDelayMs } = require('../../lib/polling');
const {
  parseCoordinates,
  distanceMeters,
  predictChargingMinutes,
  updateEfficiency,
  predictRangeAtLimit
} = require('../../lib/flow-logic');
const ErrorHandler = require('../../lib/errorHandler');

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
          // The stored Enode vehicle id wasn't found. This happens when the car was re-linked
          // (repair / app reinstall / duplicate cleanup) and got a NEW id. Recover by VIN.
          const vin = deviceData.vin;
          const vehicleByVin = vin ? vehicles.find(v => v.information?.vin === vin) : null;

          if (vehicleByVin) {
            // Adopt the new id and CONTINUE initialising. Do NOT return here — returning would
            // skip polling/health-check setup, leaving the device visible but never updating.
            this.log(`Vehicle ID ${this.vehicleId} not found; recovered by VIN ${vin} -> ${vehicleByVin.id}`);
            this.vehicleId = vehicleByVin.id;
            await this.setSettings({ vehicleId: vehicleByVin.id });
            await this.setStoreValue('vehicleId', vehicleByVin.id);
            this.log(`Verified vehicle with VIN ${vin}: ${vehicleByVin.information?.brand} ${vehicleByVin.information?.model}`);
          } else {
            const notFoundError = new Error(`Vehicle ${this.vehicleId} not found in user's account`);
            const handled = ErrorHandler.translateError(notFoundError, 'vehicleVerification');

            this.error(`Vehicle not found: ${vehicles.map(v => ({ id: v.id, name: v.name }))}`);
            await this.setUnavailable(handled.message);
            return;
          }
        } else {
          this.log(`Verified vehicle ${this.vehicleId} exists in user's account: ${vehicle.information?.brand} ${vehicle.information?.model}, reachable: ${vehicle.isReachable}`);
        }
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
      this.scheduleNextPoll();

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
      this._deleted = true;
      this.clearTimers();

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

  /**
   * Stop timers when the app stops or the device is removed.
   */
  async onUninit() {
    this._deleted = true;
    this.clearTimers();
  }

  /**
   * Clear every timer this device owns.
   */
  clearTimers() {
    this.clearPollTimer();
    if (this.healthCheckInterval) {
      this.homey.clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.initRetryTimeout) {
      this.homey.clearTimeout(this.initRetryTimeout);
      this.initRetryTimeout = null;
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

      // The refresh-hint wakes the car, so only use it when fresh data matters
      const now = Date.now();
      const useRefresh = shouldUseRefreshHint({
        chargingStatus: this.getCapabilityValue('chargingStatus'),
        pluggedIn: this.getCapabilityValue('pluggedInStatus'),
        wasPluggedIn: this.getStoreValue('wasPluggedIn'),
        lastDataUpdate: this.getStoreValue('lastDataUpdate'),
        now
      });

      // Get the account ID for this vehicle
      const accountId = this.getStoreValue('accountId');
      if (accountId) {
        this.log(`Using account ${accountId} for vehicle ${vehicleId}`);
      }

      // Get data with or without refresh
      let data;
      if (useRefresh) {
        data = await this.enodeApi.refreshVehicleData(vehicleId, 2000, accountId);
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

      // Store current plugged in status for next comparison (keep the old value when unknown)
      if (typeof data.chargeState?.isPluggedIn === 'boolean') {
        this.setStoreValue('wasPluggedIn', data.chargeState.isPluggedIn);
      }
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

      // Learn the km per battery % for range predictions
      const efficiency = updateEfficiency(this.getStoreValue('rangeEfficiency'), finalData);
      if (efficiency !== null && efficiency !== undefined) {
        await this.setStoreValue('rangeEfficiency', efficiency);
      }

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
   * Fire flow triggers for changed capabilities. Each trigger is isolated so one failing
   * trigger cannot stop the others. Run listeners in driver.js decide per flow.
   * @param {Map} changedCapabilities - capability id -> { oldValue, newValue }
   */
  async handleFlowTriggers(changedCapabilities) {
    const fire = async (cardId, tokens, state) => {
      try {
        await this.homey.flow.getDeviceTriggerCard(cardId).trigger(this, tokens, state);
      } catch (error) {
        this.error(`Failed to trigger ${cardId}:`, error.message);
      }
    };
    const toNumber = (value) => (typeof value === 'number' ? value : parseFloat(value));

    if (changedCapabilities.has('batteryLevel')) {
      const { oldValue, newValue } = changedCapabilities.get('batteryLevel');
      const level = toNumber(newValue);
      if (!isNaN(level)) {
        await fire('battery_level_changed', { battery_level: level });
        await fire('battery_low', { battery_level: level }, {
          battery_level: level,
          previous_battery_level: oldValue === undefined ? null : toNumber(oldValue)
        });
      }
    }

    if (changedCapabilities.has('range')) {
      const { oldValue, newValue } = changedCapabilities.get('range');
      const range = toNumber(newValue);
      if (!isNaN(range)) {
        await fire('range_low', { range }, {
          range,
          previous_range: oldValue === undefined ? null : toNumber(oldValue)
        });
      }
    }

    if (changedCapabilities.has('chargingStatus')) {
      const { oldValue, newValue } = changedCapabilities.get('chargingStatus');
      this.log(`Charging status changed from ${oldValue} to ${newValue}`);

      await fire('charging_status_changed', {
        previous_status: oldValue || 'Unknown',
        current_status: newValue || 'Unknown'
      }, { current_status: newValue });

      if (newValue === 'Charging' && oldValue !== 'Charging') {
        await fire('charging_started');
      } else if (oldValue === 'Charging' && newValue !== 'Charging') {
        await fire('charging_stopped');
      }
    }

    if (changedCapabilities.has('pluggedInStatus')) {
      const { oldValue, newValue } = changedCapabilities.get('pluggedInStatus');
      if (newValue === true && oldValue !== true) {
        await fire('plugged_in');
      } else if (newValue === false && oldValue !== false) {
        await fire('unplugged');
      }
    }

    if (changedCapabilities.has('location')) {
      const { oldValue, newValue } = changedCapabilities.get('location');
      const previous = parseCoordinates(oldValue);
      const current = parseCoordinates(newValue);
      if (current) {
        const distance = previous
          ? Math.round(distanceMeters(previous.latitude, previous.longitude, current.latitude, current.longitude))
          : 0;
        await fire('location_changed', { distance }, { previous, current });
      }
    }
  }

  /**
   * Start charging. Throws a user-friendly error the flow can show.
   */
  async startCharging() {
    await this.sendChargingCommand('START');
  }

  /**
   * Stop charging. Throws a user-friendly error the flow can show.
   */
  async stopCharging() {
    await this.sendChargingCommand('STOP');
  }

  /**
   * Send a charging command, then refresh the device. A failed refresh after a successful
   * command is only logged: the command itself worked.
   * @param {'START'|'STOP'} action
   */
  async sendChargingCommand(action) {
    const context = action === 'START' ? 'startCharging' : 'stopCharging';
    const accountId = this.getStoreValue('accountId');

    try {
      if (!this.vehicleId) {
        throw new Error('Missing vehicle ID');
      }
      this.log(`Sending ${action} for vehicle ${this.vehicleId}${accountId ? ` (account ${accountId})` : ''}`);

      if (action === 'START') {
        await this.enodeApi.startCharging(this.vehicleId, accountId);
      } else {
        await this.enodeApi.stopCharging(this.vehicleId, accountId);
      }
    } catch (error) {
      const handled = ErrorHandler.translateError(error, context);
      this.error(`Failed to ${action.toLowerCase()} charging for ${this.getName()}: ${handled.original}`);
      if (this.homey && this.homey.notifications) {
        this.homey.notifications.createNotification({
          excerpt: `${this.getName()}: ${ErrorHandler.formatErrorMessage(handled)}`
        }).catch((notifyError) => this.error('Failed to create notification:', notifyError.message));
      }
      throw new Error(ErrorHandler.formatErrorMessage(handled));
    }

    try {
      await this.pollVehicleData();
    } catch (error) {
      this.error(`Charging ${action} sent, but refreshing the device failed:`, error.message);
    }
  }

  /**
   * Fetch fresh data now. Returns false on failure; the caller (flow or widget) shows the error.
   * @returns {Promise<boolean>}
   */
  async refreshData() {
    try {
      await this.pollVehicleData();
      return true;
    } catch (error) {
      const handled = ErrorHandler.translateError(error, 'refreshData');
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

  /**
   * Predicted range after charging to the charge limit, using the km per battery % this car
   * has achieved over recent polls.
   * @returns {Promise<number>} km
   */
  async predictRange() {
    return predictRangeAtLimit({
      efficiency: this.getStoreValue('rangeEfficiency'),
      chargeLimit: this.getCapabilityValue('chargingLimit'),
      batteryLevel: this.getCapabilityValue('batteryLevel'),
      range: this.getCapabilityValue('range')
    });
  }

  /**
   * Minutes until the charge limit is reached at the current charge power.
   * @returns {Promise<number>}
   */
  async predictChargingTime() {
    return predictChargingMinutes({
      batteryLevel: this.getCapabilityValue('batteryLevel'),
      chargeLimit: this.getCapabilityValue('chargingLimit'),
      capacityKwh: this.getCapabilityValue('batteryCapacity'),
      powerW: this.getCapabilityValue('measure_power')
    });
  }

  /**
   * Schedule the next poll. Each poll schedules the one after it, so the delay can follow
   * the vehicle state: the configured interval when idle, faster while charging.
   */
  scheduleNextPoll() {
    this.clearPollTimer();
    if (this._deleted) return;

    this.updateInterval = parseInt(this.getSettings().updateInterval, 10) || 10;
    const delay = nextPollDelayMs({
      intervalMinutes: this.updateInterval,
      charging: this.getCapabilityValue('chargingStatus') === 'Charging'
    });

    this.pollTimeout = this.homey.setTimeout(async () => {
      this.pollTimeout = null;
      try {
        await this.pollVehicleData();
      } catch (error) {
        this.error('Scheduled poll failed:', error.message);
      }
      this.scheduleNextPoll();
    }, delay);
  }

  /**
   * Cancel a pending poll, if any.
   */
  clearPollTimer() {
    if (this.pollTimeout) {
      this.homey.clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
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
      this.scheduleNextPoll();

      // Update health check as polling interval has changed
      this.setupHealthCheck();

      // Do an immediate poll with the new settings
      await this.pollVehicleData();
    }
  }
}

module.exports = XpengCarDevice;
