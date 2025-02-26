const Homey = require('homey');
const EnodeAPI = require('../../lib/enode-api');

class XpengDriver extends Homey.Driver {
  async onInit() {
    this.log('XPeng Driver has been initialized');
    this.enodeApi = new EnodeAPI(this.homey);
    
    // Initialize driver storage and log current values
    this.clientId = this.homey.settings.get('enode_client_id');
    this.clientSecret = this.homey.settings.get('enode_client_secret');
    
    this.log('Current stored credentials status:', {
      hasClientId: !!this.clientId,
      hasClientSecret: !!this.clientSecret
    });

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

    // Handler to get stored credentials
    session.setHandler('get_stored_credentials', async () => {
      const storedClientId = this.homey.settings.get('enode_client_id');
      const storedClientSecret = this.homey.settings.get('enode_client_secret');
      
      this.log('Retrieving stored credentials:', {
        hasClientId: !!storedClientId,
        hasClientSecret: !!storedClientSecret
      });
      
      return {
        clientId: storedClientId || '',
        clientSecret: storedClientSecret || ''
      };
    });

    session.setHandler('save_credentials', async (data) => {
      try {
        this.log('Attempting to save new credentials');
        
        this.clientId = data.clientId;
        this.clientSecret = data.clientSecret;
        
        // Input validation first
        if (!this.clientId || this.clientId.trim() === '') {
          throw new Error('Client ID cannot be empty');
        }
        
        if (!this.clientSecret || this.clientSecret.trim() === '') {
          throw new Error('Client Secret cannot be empty'); 
        }
        
        // Validate credentials before saving
        await this.enodeApi.getAccessToken(this.clientId, this.clientSecret);
        
        // Store credentials in Homey settings
        await this.homey.settings.set('enode_client_id', this.clientId);
        await this.homey.settings.set('enode_client_secret', this.clientSecret);
        
        // Verify storage
        const verifyClientId = this.homey.settings.get('enode_client_id');
        const verifyClientSecret = this.homey.settings.get('enode_client_secret');
        
        this.log('Credentials saved successfully:', {
          clientIdSaved: !!verifyClientId,
          clientSecretSaved: !!verifyClientSecret
        });
        
        savedCredentials = true;
        return true;
      } catch (error) {
        // Use ErrorHandler for better error messages
        const ErrorHandler = require('../../lib/errorHandler');
        const handled = ErrorHandler.translateError(error, 'saveCredentials');
        
        this.error('Failed to save credentials:', error);
        
        // For credential errors, provide more specific guidance
        if (handled.type === ErrorHandler.ErrorTypes.AUTHENTICATION) {
          throw new Error('Invalid credentials. Please check the Client ID and Secret from your Enode dashboard and try again.');
        } else if (handled.type === ErrorHandler.ErrorTypes.NETWORK) {
          throw new Error('Network issue while validating credentials. Please check your internet connection and try again.');
        } else {
          throw new Error(`${handled.message} ${handled.suggestion}`);
        }
      }
    });

    session.setHandler('get_link', async () => {
      try {
        if (!savedCredentials && !this.clientId && !this.clientSecret) {
          // Try to get credentials from settings if not saved in current session
          this.clientId = this.homey.settings.get('enode_client_id');
          this.clientSecret = this.homey.settings.get('enode_client_secret');
          
          this.log('Retrieved credentials for link generation:', {
            hasClientId: !!this.clientId,
            hasClientSecret: !!this.clientSecret
          });
        }

        if (!this.clientId || !this.clientSecret) {
          throw new Error('Credentials not set');
        }

        const userId = `homey-${Date.now()}`; // Generate a unique user ID
        const linkUrl = await this.enodeApi.generateVehicleLink(this.clientId, this.clientSecret, userId);
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
          this.clientId = this.homey.settings.get('enode_client_id');
          this.clientSecret = this.homey.settings.get('enode_client_secret');
          
          this.log('Retrieved credentials for device listing:', {
            hasClientId: !!this.clientId,
            hasClientSecret: !!this.clientSecret
          });
        }

        if (!this.clientId || !this.clientSecret) {
          throw new Error('Credentials not set');
        }

        // Fetch vehicles from Enode API
        const vehicles = await this.enodeApi.getVehicles(this.clientId, this.clientSecret);
        
        if (!vehicles || vehicles.length === 0) {
          throw new Error('No vehicles found. Please make sure you have completed the connection process in your browser.');
        }

        // Log found vehicles for debugging
        this.log('Found vehicles:', vehicles.map(v => ({ id: v.id, name: v.name })));

        // Map vehicles to Homey device format
        return vehicles.map(vehicle => ({
          name: vehicle.name || `XPENG ${vehicle.model || 'Vehicle'}`,
          data: {
            id: vehicle.id,
            vehicleId: vehicle.id  // Store the ID in both places for backward compatibility
          },
          store: {
            vehicleInfo: vehicle
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
        }));
      } catch (error) {
        // Use ErrorHandler for better error messages
        const ErrorHandler = require('../../lib/errorHandler');
        const handled = ErrorHandler.translateError(error, 'listDevices');
        
        this.error('Failed to list devices:', error);
        
        // Special handling for common vehicle discovery issues
        if (error.message.includes('vehicles found') || error.message.includes('No vehicles')) {
          throw new Error(
            'No XPENG vehicles found. Please ensure you have completed the connection in your browser ' +
            'and that your vehicle is properly registered with Enode.'
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

  getStoredCredentials() {
    const clientId = this.homey.settings.get('enode_client_id');
    const clientSecret = this.homey.settings.get('enode_client_secret');
    
    this.log('Getting stored credentials:', {
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret
    });
    
    return { clientId, clientSecret };
  }

}

module.exports = XpengDriver;
