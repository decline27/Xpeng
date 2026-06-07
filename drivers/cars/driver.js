const Homey = require('homey');
const EnodeAPI = require('../../lib/enode-api');
const EnodeOAuth2 = require('../../lib/enode-oauth');
const AccountManager = require('../../lib/account-manager');
const { resolveUserId, getUserIdCandidates } = require('../../lib/user-identity');
const DuplicateReaper = require('../../lib/duplicate-reaper');

class XpengDriver extends Homey.Driver {
  async onInit() {
    this.log('XPeng Driver has been initialized');

    // Initialize API clients
    this.enodeApi = new EnodeAPI(this.homey);

    // Initialize account manager
    this.accountManager = new AccountManager(this.homey);

    // Check account status
    const accountStatus = this.accountManager.checkAccountsStatus();
    this.log('Enode accounts status:', {
      primaryConfigured: accountStatus.primaryConfigured,
      secondaryConfigured: accountStatus.secondaryConfigured,
      defaultAccount: this.accountManager.getDefaultAccount()
    });

    // Get credentials for the default account
    const credentials = this.accountManager.getCredentials();
    this.clientId = credentials.clientId;
    this.clientSecret = credentials.clientSecret;

    // Initialize OAuth2 client with default account credentials
    this.oAuth2Client = new EnodeOAuth2({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      redirectUri: 'https://callback.athom.com/oauth2/callback',
      homey: this.homey,
      logger: this
    });

    // Initialize OAuth2 client
    try {
      this.oAuth2Client.init();
      this.log('OAuth2 client initialized');
    } catch (error) {
      this.error('Failed to initialize OAuth2 client:', error);
    }

    // Register all flow cards
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
   * Register trigger flow cards
   */
  registerTriggerCards() {
    // Battery level triggers
    this.batteryLevelChangedTrigger = this.homey.flow.getDeviceTriggerCard('battery_level_changed');
    this.batteryLowTrigger = this.homey.flow.getDeviceTriggerCard('battery_low');
    this.batteryLowTrigger.registerRunListener(async (args, state) => {
      return state.battery_level <= args.threshold;
    });

    // Charging state triggers
    this.chargingStartedTrigger = this.homey.flow.getDeviceTriggerCard('charging_started');
    this.chargingStoppedTrigger = this.homey.flow.getDeviceTriggerCard('charging_stopped');
    this.chargingStatusChangedTrigger = this.homey.flow.getDeviceTriggerCard('charging_status_changed');

    // Connection state triggers
    this.pluggedInTrigger = this.homey.flow.getDeviceTriggerCard('plugged_in');
    // Register trigger explicitly (for safety)
    this.log('Registering plugged_in trigger card');

    this.unpluggedTrigger = this.homey.flow.getDeviceTriggerCard('unplugged');

    // Range triggers
    this.rangeLowTrigger = this.homey.flow.getDeviceTriggerCard('range_low');
    this.rangeLowTrigger.registerRunListener(async (args, state) => {
      return state.range <= args.threshold;
    });

    // Location triggers
    this.locationChangedTrigger = this.homey.flow.getDeviceTriggerCard('location_changed');
  }

  /**
   * Register condition flow cards
   */
  registerConditionCards() {
    // Battery level condition
    this.batteryLevelCondition = this.homey.flow.getConditionCard('battery_level');
    this.batteryLevelCondition.registerRunListener(async (args, state) => {
      try {
        const { device, value, comparison } = args;
        const batteryValue = device.getCapabilityValue('batteryLevel');
        const batteryLevel = typeof batteryValue === 'number' ? batteryValue : parseFloat(batteryValue);

        this.log(`Battery level check: ${batteryValue} (${batteryLevel}) ${comparison} ${value}`);

        if (isNaN(batteryLevel)) {
          return false;
        }

        switch (comparison) {
          case 'greater': return batteryLevel > value;
          case 'lower': return batteryLevel < value;
          case 'equals': return batteryLevel === value;
          default: return false;
        }
      } catch (error) {
        this.error('Error in battery level condition:', error);
        return false;
      }
    });

    // Charging status condition
    this.isChargingCondition = this.homey.flow.getConditionCard('is_charging');
    this.isChargingCondition.registerRunListener(async (args, state) => {
      try {
        const { device } = args;
        const charging = device.getCapabilityValue('chargingStatus') === 'Charging';
        this.log(`Is charging check: ${charging}`);
        return charging;
      } catch (error) {
        this.error('Error in is charging condition:', error);
        return false;
      }
    });

    // Plugged in condition
    this.pluggedInCondition = this.homey.flow.getConditionCard('plugged_in_status');
    this.pluggedInCondition.registerRunListener(async (args, state) => {
      try {
        const { device } = args;
        const isPluggedIn = device.getCapabilityValue('pluggedInStatus') === true;
        this.log(`Plugged in check: ${isPluggedIn}`);
        return isPluggedIn;
      } catch (error) {
        this.error('Error in plugged in condition:', error);
        return false;
      }
    });

    // Range condition
    this.rangeCondition = this.homey.flow.getConditionCard('range_check');
    this.rangeCondition.registerRunListener(async (args, state) => {
      try {
        const { device, value, comparison } = args;
        const rangeStr = device.getCapabilityValue('range');
        const rangeMatch = rangeStr && rangeStr.match(/(\d+)/);
        const range = rangeMatch ? parseInt(rangeMatch[1], 10) : NaN;

        this.log(`Range check: ${rangeStr} (${range}) ${comparison} ${value}`);

        if (isNaN(range)) {
          return false;
        }

        switch (comparison) {
          case 'greater': return range > value;
          case 'lower': return range < value;
          case 'equals': return range === value;
          default: return false;
        }
      } catch (error) {
        this.error('Error in range condition:', error);
        return false;
      }
    });

    // Location condition - check if car is within radius of given coordinates
    this.locationCondition = this.homey.flow.getConditionCard('location_check');
    this.locationCondition.registerRunListener(async (args, state) => {
      try {
        const { device, latitude, longitude, radius } = args;
        const currentLocation = device.getCapabilityValue('location');

        if (!currentLocation || currentLocation === 'Not Available') {
          return false;
        }

        // Parse coordinates from format: "55.579°N, 12.951°E (55.578804,12.951104)"
        const coordMatch = currentLocation.match(/\(([^,]+),([^)]+)\)/);
        if (!coordMatch) {
          return false;
        }

        const carLat = parseFloat(coordMatch[1]);
        const carLng = parseFloat(coordMatch[2]);

        if (isNaN(carLat) || isNaN(carLng)) {
          return false;
        }

        // Haversine formula to calculate distance in meters
        const R = 6371000; // Earth radius in meters
        const dLat = (latitude - carLat) * Math.PI / 180;
        const dLng = (longitude - carLng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(carLat * Math.PI / 180) * Math.cos(latitude * Math.PI / 180) *
          Math.sin(dLng / 2) * Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        const distance = R * c;

        this.log(`Location check: car at (${carLat},${carLng}), target (${latitude},${longitude}), distance: ${Math.round(distance)}m, radius: ${radius}m`);

        return distance <= radius;
      } catch (error) {
        this.error('Error in location condition:', error);
        return false;
      }
    });

    // Charging status specific condition
    this.chargingStatusCondition = this.homey.flow.getConditionCard('charging_status');
    this.chargingStatusCondition.registerRunListener(async (args, state) => {
      try {
        const { device, status } = args;
        const currentStatus = device.getCapabilityValue('chargingStatus');

        this.log(`Charging status check: current "${currentStatus}" against "${status}"`);

        // Match the status from dropdown to the actual device status
        switch (status) {
          case 'charging':
            return currentStatus === 'Charging';
          case 'not_charging':
            return currentStatus === 'Connected' || currentStatus === 'Not Connected';
          case 'charging_complete':
            return currentStatus === 'Charge Complete';
          case 'charging_scheduled':
            return currentStatus === 'Scheduled';
          case 'charging_error':
            return currentStatus === 'Error';
          default:
            return false;
        }
      } catch (error) {
        this.error('Error in charging status condition:', error);
        return false;
      }
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
   * Handles the device pairing process
   * @param {Object} session - The pairing session object
   */
  async onPair(session) {
    let savedCredentials = false;
    let pairingStartTime = Date.now();

    // Log pairing start
    this.log('Starting XPENG pairing process');

    // Handler to get stored credentials status (not the actual credentials)
    session.setHandler('get_stored_credentials', async () => {
      const storedClientId = this.homey.settings.get('enode_client_id') || Homey.env.ENODE_CLIENT_ID;
      const storedClientSecret = this.homey.settings.get('enode_client_secret') || Homey.env.ENODE_CLIENT_SECRET;

      this.log('Checking credentials status:', {
        hasClientId: !!storedClientId,
        hasClientSecret: !!storedClientSecret
      });

      // Only return whether credentials are available, not the actual values
      return {
        hasCredentials: !!(storedClientId && storedClientSecret)
      };
    });

    // This handler is now just a validation step, not actually saving user-provided credentials
    session.setHandler('save_credentials', async () => {
      try {
        this.log('Validating API credentials');

        // Get credentials from env.json or settings
        this.clientId = Homey.env.ENODE_CLIENT_ID || this.homey.settings.get('enode_client_id');
        this.clientSecret = Homey.env.ENODE_CLIENT_SECRET || this.homey.settings.get('enode_client_secret');

        // Input validation
        if (!this.clientId || this.clientId.trim() === '') {
          throw new Error('Client ID is not configured. Please create an env.json file with your ENODE_CLIENT_ID value.');
        }

        if (!this.clientSecret || this.clientSecret.trim() === '') {
          throw new Error('Client Secret is not configured. Please create an env.json file with your ENODE_CLIENT_SECRET value.');
        }

        // Validate credentials by getting a machine token
        await this.enodeApi.getAccessToken();

        // Update OAuth2 client with credentials
        this.oAuth2Client = new EnodeOAuth2({
          clientId: this.clientId,
          clientSecret: this.clientSecret,
          redirectUri: 'https://callback.athom.com/oauth2/callback',
          homey: this.homey,
          logger: this
        });

        try {
          this.oAuth2Client.init();
          this.log('OAuth2 client initialized with credentials');
        } catch (error) {
          this.error('Failed to initialize OAuth2 client:', error);
          // Non-blocking error, continue with pairing
        }

        savedCredentials = true;
        return true;
      } catch (error) {
        // Use ErrorHandler for better error messages
        const ErrorHandler = require('../../lib/errorHandler');
        const handled = ErrorHandler.translateError(error, 'validateCredentials');

        this.error('Failed to validate credentials:', error);

        // For credential errors, provide more specific guidance
        if (handled.type === ErrorHandler.ErrorTypes.AUTHENTICATION) {
          throw new Error('Invalid API credentials. Please contact the app developer.');
        } else if (handled.type === ErrorHandler.ErrorTypes.NETWORK) {
          throw new Error('Network issue while validating credentials. Please check your internet connection and try again.');
        } else {
          throw new Error(`${handled.message} ${handled.suggestion}`);
        }
      }
    });

    // Add a handler to check if the user has authenticated vehicles
    session.setHandler('check_auth_status', async () => {
      try {
        // Stable user ID (survives reinstall), plus legacy id for migration dual-matching.
        const userId = await resolveUserId(this.homey);
        const userIdCandidates = await getUserIdCandidates(this.homey);

        // Fetch vehicles from Enode API
        const allVehicles = await this.enodeApi.getVehicles();

        // Filter vehicles by user ID (stable or legacy)
        const userVehicles = allVehicles.filter(vehicle =>
          userIdCandidates.includes(vehicle.userId) ||
          (vehicle.user && userIdCandidates.includes(vehicle.user.id))
        );

        this.log(`Auth status check: Found ${userVehicles.length} vehicles for user ID ${userId}`);

        // Return authentication status
        return {
          isAuthenticated: userVehicles.length > 0,
          vehicleCount: userVehicles.length
        };
      } catch (error) {
        this.error('Error checking authentication status:', error);
        return { isAuthenticated: false, vehicleCount: 0 };
      }
    });

    session.setHandler('get_link', async () => {
      try {
        if (!savedCredentials && !this.clientId && !this.clientSecret) {
          // Try to get credentials from settings if not saved in current session
          this.clientId = this.homey.settings.get('enode_client_id') || Homey.env.ENODE_CLIENT_ID;
          this.clientSecret = this.homey.settings.get('enode_client_secret') || Homey.env.ENODE_CLIENT_SECRET;

          this.log('Retrieved credentials for link generation:', {
            hasClientId: !!this.clientId,
            hasClientSecret: !!this.clientSecret
          });
        }

        if (!this.clientId || !this.clientSecret) {
          throw new Error('Credentials not set');
        }

        // Stable user ID (Homey Cloud ID based) so re-linking reuses the same Enode user
        // instead of creating a duplicate. generateVehicleLink pins to the user's existing
        // client if they already exist on one.
        const userId = await resolveUserId(this.homey);
        this.log(`Using stable user ID for vehicle link: ${userId}`);

        const linkUrl = await this.enodeApi.generateVehicleLink(userId);
        return { linkUrl };
      } catch (error) {
        // Use ErrorHandler for better error messages
        const ErrorHandler = require('../../lib/errorHandler');
        const handled = ErrorHandler.translateError(error, 'generateLink');

        this.error('Failed to generate vehicle link:', error);

        // Provide more specific guidance based on error type
        if (handled.type === ErrorHandler.ErrorTypes.AUTHENTICATION) {
          throw new Error(
            'Authentication failed while generating the link. Please make sure your Enode credentials are correct.'
          );
        } else if (handled.type === ErrorHandler.ErrorTypes.NETWORK) {
          throw new Error(
            'Cannot connect to Enode services. Please check your internet connection and try again in a few minutes.'
          );
        } else if (handled.type === ErrorHandler.ErrorTypes.CONFIGURATION) {
          throw new Error(
            'Configuration error. Please re-enter your Enode credentials in the previous step.'
          );
        } else {
          throw new Error(`Problem generating link: ${handled.message} ${handled.suggestion}`);
        }
      }
    });

    session.setHandler('list_devices', async () => {
      try {
        if (!savedCredentials && !this.clientId && !this.clientSecret) {
          // Try to get credentials from settings if not saved in current session
          this.clientId = this.homey.settings.get('enode_client_id') || Homey.env.ENODE_CLIENT_ID;
          this.clientSecret = this.homey.settings.get('enode_client_secret') || Homey.env.ENODE_CLIENT_SECRET;

          this.log('Retrieved credentials for device listing:', {
            hasClientId: !!this.clientId,
            hasClientSecret: !!this.clientSecret
          });
        }

        if (!this.clientId || !this.clientSecret) {
          throw new Error('Credentials not set');
        }

        // Fetch vehicles from Enode API
        let allVehicles = await this.enodeApi.getVehicles();

        if (!allVehicles || allVehicles.length === 0) {
          throw new Error('No vehicles found. Please make sure you have completed the connection process in your browser.');
        }

        // Log found vehicles for debugging
        this.log('Found vehicles:', allVehicles.map(v => ({ id: v.id, name: v.name, userId: v.userId })));

        // Stable user ID plus legacy id, so users see their car across the migration.
        const userId = await resolveUserId(this.homey);
        const userIdCandidates = await getUserIdCandidates(this.homey);
        this.log('Using user IDs for vehicle filtering:', userIdCandidates.join(', '));

        // SECURITY IMPROVEMENT: Filter vehicles by user ID
        // This ensures users only see their own vehicles
        const userVehicles = allVehicles.filter(vehicle =>
          userIdCandidates.includes(vehicle.userId) ||
          (vehicle.user && userIdCandidates.includes(vehicle.user.id))
        );

        // Get authorized VINs from settings
        const authorizedVins = this.homey.settings.get('authorized_vins') || [];
        this.log(`Found ${authorizedVins.length} authorized VINs in settings`);

        // First try to filter by authorized VINs
        let vinFilteredVehicles = [];
        if (authorizedVins.length > 0) {
          vinFilteredVehicles = allVehicles.filter(vehicle =>
            authorizedVins.includes(vehicle.information?.vin)
          );
          this.log(`Found ${vinFilteredVehicles.length} vehicles matching authorized VINs`);
        }

        // If we found vehicles for this user by ID, use those
        // Otherwise, if we found vehicles by VIN, use those
        // As a last resort during pairing, show all vehicles
        let vehicles = allVehicles;

        if (userVehicles.length > 0) {
          this.log(`Found ${userVehicles.length} vehicles for user ID ${userId}. Using these vehicles.`);
          vehicles = userVehicles;

          // Store the VINs of these vehicles in the authorized list if they're not already there
          userVehicles.forEach(vehicle => {
            const vin = vehicle.information?.vin;
            if (vin && !authorizedVins.includes(vin)) {
              authorizedVins.push(vin);
              this.log(`Adding VIN ${vin} to authorized list from user ID match`);
            }
          });

          // Update the authorized VINs in settings
          if (authorizedVins.length > 0) {
            this.homey.settings.set('authorized_vins', authorizedVins);
            // Clear any cached data in the API client to ensure fresh data
            if (this.enodeApi && this.enodeApi.requestCache) {
              this.enodeApi.requestCache.clear('vehicles');
            }
          }
        } else if (vinFilteredVehicles.length > 0) {
          this.log(`Using ${vinFilteredVehicles.length} vehicles matching authorized VINs`);
          vehicles = vinFilteredVehicles;
        } else {
          this.log(`No vehicles found specifically for user ID ${userId} or matching authorized VINs. Returning empty list for security.`);
          // SECURITY IMPROVEMENT: Never show all vehicles, even during initial pairing
          // Instead, we'll throw a helpful error message below when vehicles.length is 0
          vehicles = [];
        }

        // Check if we have any vehicles to show
        if (vehicles.length === 0) {
          throw new Error(
            'No vehicles linked to your account yet.\n\n' +
            'NEXT STEPS:\n' +
            '1. Click "Generate Connection Link" to get your personal linking URL\n' +
            '2. Open the link in your browser and sign in with your XPENG account\n' +
            '3. Authorize the connection to link your vehicle\n' +
            '4. Wait 1-2 minutes, then return here and continue\n\n' +
            'If you already completed these steps, please wait a few minutes and try again.'
          );
        }

        // Group vehicles by VIN to detect duplicates
        const vehiclesByVin = {};
        vehicles.forEach(vehicle => {
          const vin = vehicle.information?.vin;
          if (vin) {
            if (!vehiclesByVin[vin]) {
              vehiclesByVin[vin] = [];
            }
            vehiclesByVin[vin].push(vehicle);
          }
        });

        // For each VIN, select the most recently seen vehicle
        const uniqueVehicles = [];
        Object.values(vehiclesByVin).forEach(duplicates => {
          // Sort by lastSeen date (most recent first)
          duplicates.sort((a, b) => {
            const dateA = new Date(a.lastSeen || 0);
            const dateB = new Date(b.lastSeen || 0);
            return dateB - dateA;
          });

          // Add the most recent vehicle
          uniqueVehicles.push(duplicates[0]);

          // Log if duplicates were found
          if (duplicates.length > 1) {
            this.log(`Found ${duplicates.length} vehicles with VIN ${duplicates[0].information?.vin}. Using the most recently seen one.`);
          }
        });

        // Map unique vehicles to Homey device format
        return uniqueVehicles.map(vehicle => {
          const vin = vehicle.information?.vin || 'unknown';
          const model = vehicle.information?.model || 'Vehicle';

          return {
            name: vehicle.name || `XPENG ${model} (${vin.substring(vin.length - 6)})`,
            data: {
              id: vehicle.id,
              vehicleId: vehicle.id,  // Store the ID in both places for backward compatibility
              vin: vin  // Store the VIN for future reference
            },
            store: {
              vehicleInfo: vehicle,
              oAuth2TokenData: this.oAuth2Client.getTokenData() // Store OAuth2 token data for the device
            },
            capabilities: [
              'batteryLevel',
              'batteryCapacity',
              'chargingStatus',
              'pluggedInStatus',
              'range',
              'location',
              'lastSeen',
              'odometer',
              'vehicleBrand',
              'vehicleModel',
              'vehicleYear',
              'vehicleVin',
              'chargingLimit',
              'powerDeliveryState'
            ]
          };
        });
      } catch (error) {
        // Use ErrorHandler for better error messages
        const ErrorHandler = require('../../lib/errorHandler');
        const handled = ErrorHandler.translateError(error, 'listDevices');

        this.error('Failed to list devices:', error);

        // Special handling for common vehicle discovery issues
        if (error.message.includes('vehicles found') || error.message.includes('No vehicles')) {
          throw new Error(
            'No XPENG vehicles found. Please make sure you have:\n\n' +
            '1. Completed the connection process by clicking the link and authorizing in your browser\n' +
            '2. Waited a few minutes for the connection to be established\n' +
            '3. If problems persist, try clicking "Generate Connection Link" again'
          );
        } else if (handled.type === ErrorHandler.ErrorTypes.AUTHENTICATION) {
          throw new Error(
            'Authentication error when connecting to Enode. Please check your credentials and try again.'
          );
        } else if (handled.type === ErrorHandler.ErrorTypes.NETWORK) {
          throw new Error(
            'Cannot connect to Enode services. Please check your internet connection and try again later.'
          );
        } else {
          throw new Error(`${handled.message} ${handled.suggestion}`);
        }
      }
    });

    // Handle device added event
    session.setHandler('add_device', async (data) => {
      try {
        // Extract the VIN from the device data
        const vin = data.data?.vin;
        if (vin) {
          // Get the current list of authorized VINs
          const authorizedVins = this.homey.settings.get('authorized_vins') || [];

          // Add this VIN if it's not already in the list
          if (!authorizedVins.includes(vin)) {
            authorizedVins.push(vin);
            this.homey.settings.set('authorized_vins', authorizedVins);
            this.log(`Added VIN ${vin} to authorized list. Total authorized VINs: ${authorizedVins.length}`);

            // Clear any cached data in the API client to ensure fresh data
            if (this.enodeApi && this.enodeApi.requestCache) {
              this.enodeApi.requestCache.clear('vehicles');
            }
          } else {
            this.log(`VIN ${vin} already in authorized list`);
          }

          // Auto-reap: now that this car is connected (freshly seen), remove any older stale
          // copies of the same VIN that linger under other Enode users/clients. Non-fatal.
          await this._autoReapDuplicates(vin);
        } else {
          this.log('No VIN found in device data during add_device');
        }
        return true;
      } catch (error) {
        this.error('Error in add_device handler:', error);
        return true; // Continue with device addition even if storing VIN fails
      }
    });

    // Handle session completion
    session.setHandler('complete', async () => {
      const pairingDuration = (Date.now() - pairingStartTime) / 1000;
      this.log(`XPENG pairing process completed in ${pairingDuration.toFixed(1)} seconds`);

      // Track usage statistics (non-PII)
      try {
        this.homey.settings.set('last_pairing_duration', pairingDuration);
        this.homey.settings.set('last_pairing_time', new Date().toISOString());

        const pairingCount = this.homey.settings.get('pairing_count') || 0;
        this.homey.settings.set('pairing_count', pairingCount + 1);
      } catch (error) {
        // Non-critical, just log
        this.error('Failed to save pairing statistics:', error);
      }

      return true;
    });
  }

  /**
   * Handles the device repair process
   * @param {Object} session - The repair session object
   * @param {Object} device - The device being repaired
   */
  async onRepair(session, device) {
    this.log(`Repairing device: ${device.getName()}`);
    let savedCredentials = false;

    // Use the same handlers as pairing, focusing on the link generation

    // Handler to get stored credentials status
    session.setHandler('get_stored_credentials', async () => {
      const storedClientId = this.homey.settings.get('enode_client_id') || Homey.env.ENODE_CLIENT_ID;
      const storedClientSecret = this.homey.settings.get('enode_client_secret') || Homey.env.ENODE_CLIENT_SECRET;

      return {
        hasCredentials: !!(storedClientId && storedClientSecret)
      };
    });

    // Validating API credentials
    session.setHandler('save_credentials', async () => {
      try {
        this.clientId = Homey.env.ENODE_CLIENT_ID || this.homey.settings.get('enode_client_id');
        this.clientSecret = Homey.env.ENODE_CLIENT_SECRET || this.homey.settings.get('enode_client_secret');

        if (!this.clientId || !this.clientSecret) {
          throw new Error('API Credentials not configured in env.json');
        }

        // Validate credentials
        await this.enodeApi.getAccessToken();

        savedCredentials = true;
        return true;
      } catch (error) {
        throw new Error(`Credential validation failed: ${error.message}`);
      }
    });

    // Add authentication status check (required by UI polling)
    session.setHandler('check_auth_status', async () => {
      try {
        const vehicleInfo = device.getStoreValue('vehicleInfo');
        const userId = vehicleInfo?.userId || await resolveUserId(this.homey);

        // Fetch vehicles from Enode API
        const allVehicles = await this.enodeApi.getVehicles();

        // Check if ANY vehicle exists for this user (same logic as onPair)
        const userVehicles = allVehicles.filter(vehicle =>
          vehicle.userId === userId ||
          (vehicle.user && vehicle.user.id === userId)
        );

        this.log(`Repair auth check: Found ${userVehicles.length} vehicles for user ID ${userId}`);

        return {
          isAuthenticated: userVehicles.length > 0,
          vehicleCount: userVehicles.length
        };
      } catch (error) {
        this.error('Error checking repair auth status:', error);
        return { isAuthenticated: false, vehicleCount: 0 };
      }
    });

    // Generate link for the existing user ID of the device
    session.setHandler('get_link', async () => {
      try {
        const vehicleInfo = device.getStoreValue('vehicleInfo');
        const userId = vehicleInfo?.userId || await resolveUserId(this.homey);

        this.log(`Generating repair link for user ID: ${userId}`);

        // Generate the vehicle link
        const linkUrl = await this.enodeApi.generateVehicleLink(userId);
        return { linkUrl };
      } catch (error) {
        this.error('Failed to generate repair link:', error);
        throw new Error(`Problem generating link: ${error.message}`);
      }
    });

    // Handle device list (required by UI to proceed to final step)
    session.setHandler('list_devices', async () => {
      // In repair mode, we just want to confirm the device still exists or can be matched
      // We'll return the current device as the only option
      const vin = device.getData()?.vin;
      const vehicleInfo = device.getStoreValue('vehicleInfo');

      return [{
        name: device.getName(),
        data: device.getData(),
        store: {
          vehicleInfo: vehicleInfo
        }
      }];
    });

    // Handle repair completion
    session.setHandler('complete', async () => {
      this.log(`Repair process completed for ${device.getName()}`);
      // Refresh data to confirm link is working
      try {
        await device.refreshData();
      } catch (error) {
        this.error('Failed to refresh data after repair:', error);
      }
      return true;
    });
  }

  /**
   * Remove stale duplicate copies of a VIN after it has (re)connected. Keeps the freshly
   * connected copy and only disconnects users whose every car is a stale duplicate (the
   * reaper's safety rule). Controlled by the `auto_reap_enabled` setting (default ON); logs
   * what it would do even when disabled. Never throws into the pairing flow.
   * @param {string} vin
   * @private
   */
  async _autoReapDuplicates(vin) {
    try {
      if (!vin) {
        return;
      }
      const execute = this.homey.settings.get('auto_reap_enabled') !== false; // default ON
      // Clear caches so the reaper scans fresh raw per-client data, not the dedup cache.
      if (this.enodeApi && this.enodeApi.requestCache) {
        this.enodeApi.requestCache.clear();
      }
      const result = await DuplicateReaper.reapForVin(this.enodeApi, vin, {
        execute,
        logger: this,
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

  /**
   * Get stored credentials from env.json or Homey settings
   * @param {string} accountId - Optional account ID to get credentials for
   * @returns {Object} The credentials object
   */
  getStoredCredentials(accountId = null) {
    // Use the account manager to get credentials
    const credentials = this.accountManager.getCredentials(accountId);

    this.log(`Getting stored credentials for account ${accountId || 'default'}:`, {
      hasClientId: !!credentials.clientId,
      hasClientSecret: !!credentials.clientSecret,
      accountId: credentials.accountId
    });

    return credentials;
  }

  /**
   * Check for duplicate vehicles and log information about them
   * This can help diagnose issues with multiple copies of the same vehicle
   */
  async checkForDuplicates() {
    try {
      const DuplicateCleanup = require('../../lib/cleanup-duplicates');
      const cleanup = new DuplicateCleanup(this.enodeApi);
      cleanup.logger = this;

      await cleanup.logDuplicateInfo();
      return true;
    } catch (error) {
      this.error('Error checking for duplicates:', error);
      return false;
    }
  }

  /**
   * Get a vehicle by VIN
   * If multiple vehicles with the same VIN exist, returns the most recently seen one
   * @param {string} vin - The VIN to look for
   * @returns {Promise<Object|null>} The vehicle or null if not found
   */
  async getVehicleByVin(vin) {
    try {
      if (!vin) {
        return null;
      }

      // Get all vehicles
      const vehicles = await this.enodeApi.getVehicles();

      // Find vehicles with matching VIN
      const matches = vehicles.filter(v => v.information?.vin === vin);

      if (matches.length === 0) {
        return null;
      }

      // If only one match, return it
      if (matches.length === 1) {
        return matches[0];
      }

      // If multiple matches, get the most recently seen one
      const DuplicateCleanup = require('../../lib/cleanup-duplicates');
      const cleanup = new DuplicateCleanup(this.enodeApi);
      return cleanup.getBestVehicle(matches);
    } catch (error) {
      this.error(`Error getting vehicle by VIN ${vin}:`, error);
      return null;
    }
  }

}

module.exports = XpengDriver;
