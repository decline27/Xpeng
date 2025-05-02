const Homey = require('homey');
const EnodeAPI = require('../../lib/enode-api');
const EnodeOAuth2 = require('../../lib/enode-oauth');

class XpengDriver extends Homey.Driver {
  async onInit() {
    this.log('XPeng Driver has been initialized');

    // Initialize API clients
    this.enodeApi = new EnodeAPI(this.homey);

    // Initialize driver storage and log current values
    this.clientId = this.homey.settings.get('enode_client_id') || Homey.env.ENODE_CLIENT_ID;
    this.clientSecret = this.homey.settings.get('enode_client_secret') || Homey.env.ENODE_CLIENT_SECRET;

    this.log('Current stored credentials status:', {
      hasClientId: !!this.clientId,
      hasClientSecret: !!this.clientSecret
    });

    // Initialize OAuth2 client
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
        const batteryLevel = parseInt(batteryValue, 10);

        this.log(`Battery level check: ${batteryValue} (${batteryLevel}) ${comparison} ${value}`);

        if (isNaN(batteryLevel)) {
          return false;
        }

        switch (comparison) {
          case 'lt': return batteryLevel < value;
          case 'lte': return batteryLevel <= value;
          case 'eq': return batteryLevel === value;
          case 'gte': return batteryLevel >= value;
          case 'gt': return batteryLevel > value;
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
          case 'lt': return range < value;
          case 'lte': return range <= value;
          case 'eq': return range === value;
          case 'gte': return range >= value;
          case 'gt': return range > value;
          default: return false;
        }
      } catch (error) {
        this.error('Error in range condition:', error);
        return false;
      }
    });

    // Location condition
    this.locationCondition = this.homey.flow.getConditionCard('location_check');
    this.locationCondition.registerRunListener(async (args, state) => {
      try {
        const { device, location } = args;
        const currentLocation = device.getCapabilityValue('location');

        this.log(`Location check: "${currentLocation}" contains "${location}"`);

        // This is a simplified check. In reality, you might want to do
        // distance calculations between coordinates
        return currentLocation && currentLocation.includes(location);
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
        // Get the installation ID to create a unique identifier
        const installationId = this.homey.settings.get('installation_id');
        if (!installationId) {
          // Generate and save a unique installation ID if not already set
          const newInstallationId = Date.now().toString();
          this.homey.settings.set('installation_id', newInstallationId);
        }

        // Get the Homey ID and installation ID to create a unique user ID
        const homeyId = this.homey.id || 'homey';
        const userId = `homey-${homeyId}-${installationId || Date.now().toString()}`;

        // Fetch vehicles from Enode API
        const allVehicles = await this.enodeApi.getVehicles();

        // Filter vehicles by user ID
        const userVehicles = allVehicles.filter(vehicle =>
          vehicle.userId === userId ||
          (vehicle.user && vehicle.user.id === userId)
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

        // Get or create an installation ID (only generated once per app installation)
        let installationId = this.homey.settings.get('installation_id');
        if (!installationId) {
          installationId = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
          this.homey.settings.set('installation_id', installationId);
          this.log('Created new installation ID:', installationId);
        }

        // Use a consistent user ID based on the Homey device ID and installation ID
        // This ensures we don't create duplicate entries in Enode and improves uniqueness
        const homeyId = this.homey.id || 'homey';

        // Create a more unique user ID by combining Homey ID and installation ID
        const userId = `homey-${homeyId}-${installationId}`;
        this.log('Using user ID for vehicle link:', userId);

        // Generate the vehicle link using OAuth2 client
        const linkUrl = await this.oAuth2Client.generateAuthUrl(userId);
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

        // Get the installation ID and Homey ID to create a unique identifier
        const homeyId = this.homey.id || 'homey';
        let installationId = this.homey.settings.get('installation_id');
        if (!installationId) {
          // If installation ID doesn't exist yet, create it
          installationId = Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
          this.homey.settings.set('installation_id', installationId);
          this.log('Created new installation ID during device listing:', installationId);
        }

        // Create a more unique user ID by combining Homey ID and installation ID
        const userId = `homey-${homeyId}-${installationId}`;
        this.log('Using user ID for vehicle filtering:', userId);

        // SECURITY IMPROVEMENT: Filter vehicles by user ID
        // This ensures users only see their own vehicles
        const userVehicles = allVehicles.filter(vehicle =>
          vehicle.userId === userId ||
          (vehicle.user && vehicle.user.id === userId)
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
            'No XPENG vehicles found. Please make sure you have:\n\n' +
            '1. Completed the connection process by clicking the link and authorizing in your browser\n' +
            '2. Waited a few minutes for the connection to be established\n' +
            '3. If problems persist, try clicking "Generate Connection Link" again'
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
   * Get stored credentials from env.json or Homey settings
   * @returns {Object} The credentials object
   */
  getStoredCredentials() {
    const clientId = Homey.env.ENODE_CLIENT_ID || this.homey.settings.get('enode_client_id');
    const clientSecret = Homey.env.ENODE_CLIENT_SECRET || this.homey.settings.get('enode_client_secret');

    this.log('Getting stored credentials:', {
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret
    });

    return { clientId, clientSecret };
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
