const Homey = require('homey');
const EnodeAPI = require('../../lib/enode-api');
const { resolveUserId, getUserIdCandidates } = require('../../lib/user-identity');
const DuplicateReaper = require('../../lib/duplicate-reaper');
const ErrorHandler = require('../../lib/errorHandler');
const {
  compareNumber,
  crossedBelow,
  matchesChargingStatus,
  parseCoordinates,
  distanceMeters,
  geofenceTransition
} = require('../../lib/flow-logic');

class XpengDriver extends Homey.Driver {
  async onInit() {
    this.log('XPENG driver initialized');
    this.enodeApi = EnodeAPI.forHomey(this.homey);
    this.registerFlowCards();
  }

  /**
   * Register all flow cards (triggers, conditions, actions)
   */
  registerFlowCards() {
    this.log('Registering flow cards...');

    this.registerTriggerCards();
    this.registerConditionCards();
    this.registerActionCards();

    this.log('All flow cards registered');
  }

  /**
   * Register trigger flow cards. The device fires the triggers with a state object; these
   * run listeners decide, per flow, whether that flow should run.
   */
  registerTriggerCards() {
    this.batteryLevelChangedTrigger = this.homey.flow.getDeviceTriggerCard('battery_level_changed');

    // Runs once when the level drops below the flow's threshold, not on every low reading
    this.batteryLowTrigger = this.homey.flow.getDeviceTriggerCard('battery_low');
    this.batteryLowTrigger.registerRunListener(async (args, state) => {
      return crossedBelow(state.previous_battery_level, state.battery_level, args.threshold);
    });

    this.chargingStartedTrigger = this.homey.flow.getDeviceTriggerCard('charging_started');
    this.chargingStoppedTrigger = this.homey.flow.getDeviceTriggerCard('charging_stopped');

    this.chargingStatusChangedTrigger = this.homey.flow.getDeviceTriggerCard('charging_status_changed');
    this.chargingStatusChangedTrigger.registerRunListener(async (args, state) => {
      return matchesChargingStatus(args.status, state.current_status);
    });

    this.pluggedInTrigger = this.homey.flow.getDeviceTriggerCard('plugged_in');
    this.unpluggedTrigger = this.homey.flow.getDeviceTriggerCard('unplugged');

    this.rangeLowTrigger = this.homey.flow.getDeviceTriggerCard('range_low');
    this.rangeLowTrigger.registerRunListener(async (args, state) => {
      return crossedBelow(state.previous_range, state.range, args.threshold);
    });

    // Geofence: runs when the car enters or exits the circle set on the card
    this.locationChangedTrigger = this.homey.flow.getDeviceTriggerCard('location_changed');
    this.locationChangedTrigger.registerRunListener(async (args, state) => {
      return geofenceTransition(state.previous, state.current, {
        latitude: args.latitude,
        longitude: args.longitude,
        radius: args.radius
      }, args.comparison);
    });
  }

  /**
   * Register condition flow cards
   */
  registerConditionCards() {
    this.batteryLevelCondition = this.homey.flow.getConditionCard('battery_level');
    this.batteryLevelCondition.registerRunListener(async (args) => {
      const { device, value, comparison } = args;
      return compareNumber(device.getCapabilityValue('batteryLevel'), comparison, value);
    });

    this.isChargingCondition = this.homey.flow.getConditionCard('is_charging');
    this.isChargingCondition.registerRunListener(async (args) => {
      return args.device.getCapabilityValue('chargingStatus') === 'Charging';
    });

    this.pluggedInCondition = this.homey.flow.getConditionCard('plugged_in_status');
    this.pluggedInCondition.registerRunListener(async (args) => {
      return args.device.getCapabilityValue('pluggedInStatus') === true;
    });

    this.rangeCondition = this.homey.flow.getConditionCard('range_check');
    this.rangeCondition.registerRunListener(async (args) => {
      const { device, value, comparison } = args;
      return compareNumber(device.getCapabilityValue('range'), comparison, value);
    });

    // Location condition - check if car is within radius of given coordinates
    this.locationCondition = this.homey.flow.getConditionCard('location_check');
    this.locationCondition.registerRunListener(async (args) => {
      const { device, latitude, longitude, radius } = args;
      const car = parseCoordinates(device.getCapabilityValue('location'));
      if (!car) return false;
      return distanceMeters(car.latitude, car.longitude, latitude, longitude) <= radius;
    });

    this.chargingStatusCondition = this.homey.flow.getConditionCard('charging_status');
    this.chargingStatusCondition.registerRunListener(async (args) => {
      return matchesChargingStatus(args.status, args.device.getCapabilityValue('chargingStatus'));
    });
  }

  /**
   * Register action flow cards
   */
  registerActionCards() {
    // Start charging action
    this.startChargingAction = this.homey.flow.getActionCard('start_charging');
    this.startChargingAction.registerRunListener(async (args, state) => {
      try {
        const device = args.device;
        this.log(`Start charging triggered for ${device.getName()}`);
        await device.startCharging();
        return true;
      } catch (error) {
        this.error('Start charging flow failed:', error);
        throw error;
      }
    });

    // Stop charging action
    this.stopChargingAction = this.homey.flow.getActionCard('stop_charging');
    this.stopChargingAction.registerRunListener(async (args, state) => {
      try {
        this.log('Stop charging flow triggered with args:', {
          deviceId: args.device?.id,
          deviceName: args.device?.getName(),
          hasDevice: !!args.device,
          hasStopCharging: typeof args.device?.stopCharging === 'function'
        });

        const device = args.device;
        if (!device) {
          throw new Error('No device provided to stop charging flow');
        }

        if (typeof device.stopCharging !== 'function') {
          this.error('Device missing stopCharging method:', {
            deviceId: device.id,
            deviceName: device.getName(),
            deviceClass: device.constructor.name,
            deviceMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(device))
          });
          throw new Error('Device does not support stop charging');
        }

        await device.stopCharging();
        return true;
      } catch (error) {
        this.error('Stop charging flow failed:', error);
        throw error; // Re-throw to show error in flow
      }
    });

    // Refresh data action
    this.refreshDataAction = this.homey.flow.getActionCard('refresh_data');
    this.refreshDataAction.registerRunListener(async (args, state) => {
      try {
        this.log('Refresh data flow triggered with args:', {
          deviceId: args.device?.id,
          deviceName: args.device?.getName(),
          hasDevice: !!args.device
        });

        const device = args.device;
        if (!device) {
          throw new Error('No device provided to refresh flow');
        }

        const success = await device.refreshData();
        if (!success) {
          throw new Error('Failed to refresh device data');
        }
        return true;
      } catch (error) {
        this.error('Refresh data flow failed:', error);
        throw error;
      }
    });
  }

  /**
   * Pairing: link the car through Enode, then list the user's own cars.
   * @param {Object} session - The pairing session object
   */
  async onPair(session) {
    const pairingStartTime = Date.now();
    this.log('Starting XPENG pairing process');

    const isOwnVehicle = (candidates) => (vehicle) =>
      candidates.includes(vehicle.userId) || (vehicle.user && candidates.includes(vehicle.user.id));

    // Credentials come from env.json; the page only needs to know they exist
    session.setHandler('get_stored_credentials', async () => {
      const clients = this.enodeApi.clientManager ? this.enodeApi.clientManager.getAllClients() : [];
      return { hasCredentials: clients.some(c => c.enodeClientId) || !!Homey.env.ENODE_CLIENT_ID };
    });

    session.setHandler('check_auth_status', async () => {
      try {
        if (this.enodeApi.requestCache) {
          this.enodeApi.requestCache.clear();
        }
        const candidates = await getUserIdCandidates(this.homey);
        const vehicles = (await this.enodeApi.getVehicles()).filter(isOwnVehicle(candidates));
        return { isAuthenticated: vehicles.length > 0, vehicleCount: vehicles.length };
      } catch (error) {
        this.error('Error checking authentication status:', error);
        return { isAuthenticated: false, vehicleCount: 0 };
      }
    });

    session.setHandler('get_link', async () => {
      try {
        // Stable user id, so re-linking reuses the same Enode user instead of a duplicate
        const userId = await resolveUserId(this.homey);
        const linkUrl = await this.enodeApi.generateVehicleLink(userId);
        return { linkUrl };
      } catch (error) {
        const handled = ErrorHandler.translateError(error, 'generateLink');
        this.error('Failed to generate vehicle link:', error);
        throw new Error(`Problem generating link: ${handled.message} ${handled.suggestion}`);
      }
    });

    session.setHandler('list_devices', async () => {
      try {
        const allVehicles = await this.enodeApi.getVehicles();
        const candidates = await getUserIdCandidates(this.homey);
        let vehicles = allVehicles.filter(isOwnVehicle(candidates));

        // Fall back to cars this Homey authorised before (e.g. linked under an older user id)
        if (vehicles.length === 0) {
          const authorizedVins = this.homey.settings.get('authorized_vins') || [];
          vehicles = allVehicles.filter(v => authorizedVins.includes(v.information?.vin));
        }

        if (vehicles.length === 0) {
          throw new Error(
            'No XPENG vehicles found. Please make sure you have:\n\n'
            + '1. Completed the connection process by clicking the link and authorizing in your browser\n'
            + '2. Waited a few minutes for the connection to be established\n'
            + '3. If problems persist, try clicking "Generate Connection Link" again'
          );
        }

        this.rememberAuthorizedVins(vehicles);

        // One entry per VIN: the most recently seen copy
        const byVin = new Map();
        for (const vehicle of vehicles) {
          const key = vehicle.information?.vin || vehicle.id;
          const existing = byVin.get(key);
          if (!existing || new Date(vehicle.lastSeen || 0) > new Date(existing.lastSeen || 0)) {
            byVin.set(key, vehicle);
          }
        }

        return [...byVin.values()].map(vehicle => {
          const vin = vehicle.information?.vin;
          const model = vehicle.information?.model || 'Vehicle';
          return {
            name: vehicle.name || `XPENG ${model}${vin ? ` (${vin.slice(-6)})` : ''}`,
            // The VIN identifies the car; the Enode id can change when the car is re-linked
            data: { id: vin || vehicle.id, vehicleId: vehicle.id, vin: vin || null },
            store: { vehicleId: vehicle.id }
          };
        });
      } catch (error) {
        this.error('Failed to list devices:', error);
        if (error.message.includes('No XPENG vehicles')) throw error;
        const handled = ErrorHandler.translateError(error, 'listDevices');
        throw new Error(`${handled.message} ${handled.suggestion}`);
      }
    });

    session.setHandler('add_device', async (device) => {
      try {
        const vin = device.data?.vin;
        if (vin) {
          this.rememberAuthorizedVins([{ information: { vin } }]);
          // Remove stale copies of this car that this Homey left behind. Non-fatal.
          await this._autoReapDuplicates(vin, device.data?.vehicleId);
        }
      } catch (error) {
        this.error('Error in add_device handler:', error);
      }
      return true;
    });

    session.setHandler('complete', async () => {
      const pairingDuration = (Date.now() - pairingStartTime) / 1000;
      this.log(`XPENG pairing process completed in ${pairingDuration.toFixed(1)} seconds`);
      return true;
    });
  }

  /**
   * Remember VINs this Homey is allowed to see, used when the user id doesn't match.
   * @param {Array} vehicles
   */
  rememberAuthorizedVins(vehicles) {
    const authorizedVins = this.homey.settings.get('authorized_vins') || [];
    let changed = false;
    for (const vehicle of vehicles) {
      const vin = vehicle.information?.vin;
      if (vin && !authorizedVins.includes(vin)) {
        authorizedVins.push(vin);
        changed = true;
      }
    }
    if (changed) {
      this.homey.settings.set('authorized_vins', authorizedVins);
    }
  }

  /**
   * Repair: re-link the car with Enode and move the device to the new Enode vehicle id.
   * @param {Object} session - The repair session object
   * @param {Object} device - The device being repaired
   */
  async onRepair(session, device) {
    this.log(`Repairing device: ${device.getName()}`);

    const ownVehicles = async () => {
      const candidates = await getUserIdCandidates(this.homey);
      const vehicles = await this.enodeApi.getVehicles();
      return vehicles.filter(vehicle =>
        candidates.includes(vehicle.userId) || (vehicle.user && candidates.includes(vehicle.user.id))
      );
    };

    session.setHandler('get_stored_credentials', async () => ({ hasCredentials: true }));

    session.setHandler('get_link', async () => {
      try {
        const userId = await resolveUserId(this.homey);
        const linkUrl = await this.enodeApi.generateVehicleLink(userId);
        return { linkUrl };
      } catch (error) {
        this.error('Failed to generate repair link:', error);
        throw new Error(`Problem generating link: ${error.message}`);
      }
    });

    session.setHandler('check_auth_status', async () => {
      try {
        if (this.enodeApi.requestCache) {
          this.enodeApi.requestCache.clear();
        }
        const vehicles = await ownVehicles();
        return { isAuthenticated: vehicles.length > 0, vehicleCount: vehicles.length };
      } catch (error) {
        this.error('Error checking repair auth status:', error);
        return { isAuthenticated: false, vehicleCount: 0 };
      }
    });

    session.setHandler('repair_complete', async () => {
      const vin = device.getData().vin;
      if (this.enodeApi.requestCache) {
        this.enodeApi.requestCache.clear();
      }
      const vehicle = (await ownVehicles()).find(v => v.information?.vin === vin);
      if (!vehicle) {
        throw new Error('Your car was not found in Enode yet. Finish connecting it in the browser, wait a minute and try again.');
      }

      await device.setVehicleId(vehicle.id);
      await device.refreshData();
      await device.setAvailable();
      this.log(`Repair completed for ${device.getName()}: now using vehicle ${vehicle.id}`);
      return { success: true, vehicleId: vehicle.id };
    });
  }

  /**
   * Remove stale duplicate copies of a VIN after it has (re)connected. Keeps the freshly
   * connected copy and only disconnects users whose every car is a stale duplicate (the
   * reaper's safety rule). Controlled by the `auto_reap_enabled` setting (default ON); logs
   * what it would do even when disabled. Never throws into the pairing flow.
   * @param {string} vin
   * @param {string} [keepVehicleId] - the Enode vehicle id that was just added; never removed
   * @private
   */
  async _autoReapDuplicates(vin, keepVehicleId = null) {
    try {
      if (!vin) {
        return;
      }
      const execute = this.homey.settings.get('auto_reap_enabled') !== false; // default ON
      // Clear caches so the reaper scans fresh raw per-client data, not the dedup cache.
      if (this.enodeApi && this.enodeApi.requestCache) {
        this.enodeApi.requestCache.clear();
      }
      // Only this Homey's own Enode users may be removed; another household linked to the
      // same car must never be disconnected.
      const ownerUserIds = await getUserIdCandidates(this.homey);
      const result = await DuplicateReaper.reapForVin(this.enodeApi, vin, {
        execute,
        logger: this,
        ownerUserIds,
        keepVehicleId,
      });
      if (!result.targets || result.targets.length === 0) {
        this.log(`Auto-reap: no stale duplicates for VIN ${vin}`);
      } else if (execute) {
        this.log(`Auto-reap: disconnected ${result.disconnected} stale copy(ies) of VIN ${vin} (failed ${result.failed})`);
      } else {
        this.log(`Auto-reap (log-only): ${result.targets.length} stale copy(ies) of VIN ${vin} would be removed`);
      }
    } catch (error) {
      this.error(`Auto-reap failed for VIN ${vin}:`, error);
    }
  }

}

module.exports = XpengDriver;
