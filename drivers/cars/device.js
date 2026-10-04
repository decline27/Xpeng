const Homey = require('homey');
const EnodeAPI = require('../../lib/enode-api');
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

const MINUTE_MS = 60 * 1000;
const INIT_RETRY_MINUTES = [1, 5, 15, 30, 60];
const HEALTH_CHECK_INTERVAL_MS = 6 * 60 * MINUTE_MS;

// Capabilities every device should have; added to devices paired with older versions
const CAPABILITIES = [
  'measure_battery',
  'ev_charging_state',
  'chargingPower',
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

class XpengCarDevice extends Homey.Device {
  async onInit() {
    try {
      this.log('XPENG device initializing');
      this.createServices();

      const settings = this.getSettings();
      this.updateInterval = parseInt(settings.updateInterval, 10) || 10;
      this.distanceUnit = settings.distanceUnit === 'mi' ? 'mi' : 'km';

      await this.migrateStorage();
      await this.ensureCarClass();
      await this.registerCapabilities();
      await this.applyDistanceUnit(this.distanceUnit);
      await this.vehicleStore.loadStaticData();

      this.initAttempt = 0;
      await this.finishSetup();
    } catch (error) {
      const handled = ErrorHandler.translateError(error, 'deviceInit');
      this.error('Failed to initialize device:', error);
      await this.setUnavailable(`${handled.message} ${handled.suggestion}`);
    }
  }

  /**
   * Create the helpers this device uses. The Enode client is shared app-wide.
   */
  createServices() {
    this.enodeApi = EnodeAPI.forHomey(this.homey);
    this.vehicleStore = new VehicleStore(this);
    this.accountManager = new AccountManager(this.homey);
  }

  /**
   * Move data older versions kept in settings into the device store, and resolve the
   * Enode vehicle id (store first, so a stale hidden setting can no longer win).
   */
  async migrateStorage() {
    const settings = this.getSettings();
    const data = this.getData();

    let vehicleId = this.getStoreValue('vehicleId');
    if (!vehicleId && settings.vehicleId) {
      vehicleId = settings.vehicleId;
      await this.setStoreValue('vehicleId', vehicleId);
    }
    this.vehicleId = vehicleId || data.vehicleId || data.id;

    if (!this.getStoreValue('storedVehicleData') && settings.storedVehicleData) {
      await this.setStoreValue('storedVehicleData', settings.storedVehicleData);
    }
  }

  /**
   * Devices paired before the car class existed were sensors.
   */
  async ensureCarClass() {
    try {
      if (typeof this.getClass === 'function' && this.getClass() !== 'car') {
        await this.setClass('car');
        this.log('Device class migrated to car');
      }
    } catch (error) {
      this.error('Failed to set device class:', error.message);
    }
  }

  /**
   * Verify the vehicle with Enode, then start polling. Retries with backoff when Enode or
   * the network is unavailable, so a short outage at boot doesn't leave the device dead.
   */
  async finishSetup() {
    if (this._deleted) return;

    try {
      await this.verifyVehicle();
    } catch (error) {
      const handled = ErrorHandler.translateError(error, 'vehicleVerification');
      this.error(`Setup failed (attempt ${this.initAttempt + 1}): ${handled.original}`);
      await this.setUnavailable(`${handled.message} ${handled.suggestion}`);
      this.scheduleInitRetry();
      return;
    }

    this.initAttempt = 0;
    this.setupHealthCheck();

    try {
      await this.pollVehicleData();
    } catch (error) {
      this.error('Initial data poll failed:', error.message);
    }
    this.scheduleNextPoll();

    if (!this.getStoreValue('firstConnected')) {
      await this.setStoreValue('firstConnected', Date.now());
    }
    await this.setAvailable();
  }

  /**
   * Check the vehicle still exists in Enode. If its id changed (re-linked), recover by VIN.
   * @throws when Enode can't be reached or the vehicle is gone
   */
  async verifyVehicle() {
    if (!this.vehicleId) {
      throw new Error('Missing vehicle ID. Please repair the device.');
    }

    const vehicles = await this.enodeApi.getVehicles();
    if (vehicles.find(v => v.id === this.vehicleId)) return;

    const vin = this.getData().vin;
    const byVin = vin ? vehicles.find(v => v.information?.vin === vin) : null;
    if (!byVin) {
      throw new Error(`Vehicle ${this.vehicleId} not found in your Enode account. Use Repair to reconnect it.`);
    }

    this.log(`Vehicle ID ${this.vehicleId} not found; recovered by VIN -> ${byVin.id}`);
    await this.setVehicleId(byVin.id);
  }

  /**
   * Adopt a new Enode vehicle id (after re-linking).
   * @param {string} vehicleId
   */
  async setVehicleId(vehicleId) {
    this.vehicleId = vehicleId;
    await this.setStoreValue('vehicleId', vehicleId);
  }

  /**
   * Backoff for setup retries: 1, 5, 15, 30, then every 60 minutes.
   * @param {number} attempt - zero-based retry number
   * @returns {number} ms
   */
  initRetryDelayMs(attempt) {
    return INIT_RETRY_MINUTES[Math.min(attempt, INIT_RETRY_MINUTES.length - 1)] * MINUTE_MS;
  }

  /**
   * Schedule another setup attempt.
   */
  scheduleInitRetry() {
    if (this._deleted) return;
    if (this.initRetryTimeout) {
      this.homey.clearTimeout(this.initRetryTimeout);
    }
    const delay = this.initRetryDelayMs(this.initAttempt);
    this.initAttempt += 1;
    this.initRetryTimeout = this.homey.setTimeout(async () => {
      this.initRetryTimeout = null;
      await this.finishSetup();
    }, delay);
  }

  /**
   * Add capabilities that devices paired with older versions are missing.
   */
  async registerCapabilities() {
    for (const capability of CAPABILITIES) {
      if (!this.hasCapability(capability)) {
        try {
          this.log(`Adding missing capability: ${capability}`);
          await this.addCapability(capability);
        } catch (error) {
          this.error(`Failed to add capability ${capability}:`, error.message);
        }
      }
    }
  }

  /**
   * Show range and odometer in the chosen unit.
   * @param {'km'|'mi'} unit
   */
  async applyDistanceUnit(unit) {
    for (const capability of ['range', 'odometer']) {
      if (!this.hasCapability(capability)) continue;
      try {
        await this.setCapabilityOptions(capability, { units: { en: unit } });
      } catch (error) {
        this.error(`Failed to set units for ${capability}:`, error.message);
      }
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

  /**
   * Fetch vehicle data from Enode and update the device.
   * @returns {Promise<boolean>}
   * @throws when no data could be fetched
   */
  async pollVehicleData() {
    try {
      const vehicleId = this.vehicleId;
      if (!vehicleId) {
        throw new Error('Missing vehicle ID');
      }

      // The refresh-hint wakes the car, so only use it when fresh data matters
      const useRefresh = shouldUseRefreshHint({
        chargingStatus: this.getCapabilityValue('chargingStatus'),
        pluggedIn: this.getCapabilityValue('pluggedInStatus'),
        wasPluggedIn: this.getStoreValue('wasPluggedIn'),
        lastDataUpdate: this.getStoreValue('lastDataUpdate'),
        now: Date.now()
      });

      const accountId = this.getStoreValue('accountId');
      let data = useRefresh
        ? await this.enodeApi.refreshVehicleData(vehicleId, 2000, accountId)
        : null;
      if (!data) {
        data = await this.enodeApi.getVehicleData(vehicleId, accountId);
      }
      if (!data) {
        throw new Error('No data received from API');
      }

      // Remember which Enode client hosts this vehicle
      if (!accountId && data._accountId && data.information?.vin) {
        this.accountManager.setVehicleAccount(data.information.vin, data._accountId);
        await this.setStoreValue('accountId', data._accountId);
      }

      // Keep the previous plug state when Enode doesn't know it
      if (typeof data.chargeState?.isPluggedIn === 'boolean') {
        await this.setStoreValue('wasPluggedIn', data.chargeState.isPluggedIn);
      }
      await this.markDataReceived();

      if (this.vehicleStore.needsStaticUpdate(data)) {
        await this.vehicleStore.storeStaticData(data);
      }

      const finalData = {
        ...(this.vehicleStore.getStaticData() || {}),
        ...this.vehicleStore.processDynamicData(data, { distanceUnit: this.distanceUnit || 'km' })
      };

      await this.updateCapabilities(finalData);
      await this.updateInfoSettings(data);

      // Learn the distance per battery % for range predictions
      const efficiency = updateEfficiency(this.getStoreValue('rangeEfficiency'), finalData);
      if (efficiency !== null && efficiency !== undefined) {
        await this.setStoreValue('rangeEfficiency', efficiency);
      }

      return true;
    } catch (error) {
      this.error('Failed to poll vehicle data:', error.message);
      throw error;
    }
  }

  /**
   * Record a successful update; also ends any health-check outage.
   */
  async markDataReceived() {
    await this.setStoreValue('lastDataUpdate', Date.now());
    if (this.getStoreValue('healthNotified')) {
      await this.setStoreValue('healthNotified', false);
    }
  }

  /**
   * Fill the read-only "Vehicle information" labels in the device settings.
   * @param {Object} data - Enode vehicle
   */
  async updateInfoSettings(data) {
    try {
      await this.setSettings({
        info_vehicle_id: String(this.vehicleId || '-'),
        info_vin: String(data.information?.vin || this.getData().vin || '-'),
        info_last_sync: this.vehicleStore.formatLastSeen(new Date().toISOString())
      });
    } catch (error) {
      this.error('Failed to update vehicle information settings:', error.message);
    }
  }

  /**
   * Write capability values and fire flow triggers for the ones that changed.
   * Undefined/null values and capabilities the device doesn't have are skipped.
   * @param {Object} data - capability id -> value
   */
  async updateCapabilities(data) {
    const changedCapabilities = new Map();
    const failed = [];

    for (const [capability, value] of Object.entries(data)) {
      if (value === undefined || value === null || !this.hasCapability(capability)) continue;

      const oldValue = this.getCapabilityValue(capability);
      const newValue = capability === 'pluggedInStatus' ? value === true : value;
      try {
        await this.setCapabilityValue(capability, newValue);
        if (oldValue !== newValue) {
          changedCapabilities.set(capability, { oldValue, newValue });
        }
      } catch (error) {
        failed.push(capability);
        this.error(`Failed to set capability ${capability}:`, error.message);
      }
    }

    if (failed.length > 0) {
      this.error(`Failed to update capabilities: ${failed.join(', ')}`);
    }

    await this.handleFlowTriggers(changedCapabilities);
    await this.setAvailable();
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
      powerW: this.getCapabilityValue('chargingPower')
    });
  }

  /**
   * Schedule the next poll. Each poll schedules the one after it, so the delay can follow
   * the vehicle state: the configured interval when idle, faster while charging.
   */
  scheduleNextPoll() {
    this.clearPollTimer();
    if (this._deleted) return;

    const delay = nextPollDelayMs({
      intervalMinutes: this.updateInterval || parseInt(this.getSettings().updateInterval, 10) || 10,
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
   * Periodically check that data is still arriving.
   */
  setupHealthCheck() {
    if (this.healthCheckInterval) {
      this.homey.clearInterval(this.healthCheckInterval);
    }
    this.healthCheckInterval = this.homey.setInterval(() => {
      this.runHealthCheck().catch((error) => this.error('Health check failed:', error.message));
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * If no data arrived for a while, try a refresh. Notify once per outage when that fails.
   */
  async runHealthCheck() {
    const lastDataUpdate = this.getStoreValue('lastDataUpdate') || 0;
    const maxSilence = Math.max(20, (this.updateInterval || 10) * 2) * MINUTE_MS;
    if (Date.now() - lastDataUpdate <= maxSilence) return;

    this.log(`Health check: no data since ${new Date(lastDataUpdate).toISOString()}`);
    const success = await this.refreshData();
    if (success || this.getStoreValue('healthNotified')) return;

    await this.setStoreValue('healthNotified', true);
    const handled = ErrorHandler.translateError(new Error('Vehicle connection may be interrupted'), 'healthCheck');
    await this.homey.notifications.createNotification({
      excerpt: `${this.getName()}: no data received recently. ${handled.suggestion}`
    }).catch((error) => this.error('Failed to create notification:', error.message));
  }

  /**
   * Homey calls this before saving new settings, so use newSettings, not getSettings().
   * A failing refresh must not block saving.
   */
  async onSettings({ newSettings, changedKeys }) {
    let refresh = false;

    if (changedKeys.includes('updateInterval')) {
      this.updateInterval = parseInt(newSettings.updateInterval, 10) || 10;
      this.setupHealthCheck();
      refresh = true;
    }

    if (changedKeys.includes('distanceUnit')) {
      this.distanceUnit = newSettings.distanceUnit === 'mi' ? 'mi' : 'km';
      await this.setStoreValue('rangeEfficiency', null); // learned in the old unit
      await this.applyDistanceUnit(this.distanceUnit);
      refresh = true;
    }

    if (refresh) {
      try {
        await this.pollVehicleData();
      } catch (error) {
        this.error('Refresh after settings change failed:', error.message);
      }
      this.scheduleNextPoll();
    }
  }
}

module.exports = XpengCarDevice;
