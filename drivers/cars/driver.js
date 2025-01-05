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

    // Register Flow Actions
    this.homey.flow.getActionCard('start_charging')
      .registerRunListener(async (args, state) => {
        const device = args.device;
        await device.startCharging();
      });

    this.homey.flow.getActionCard('stop_charging')
      .registerRunListener(async (args, state) => {
        const device = args.device;
        await device.stopCharging();
      });
  }

  async onPair(session) {
    let savedCredentials = false;

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
        this.error('Failed to save credentials:', error);
        throw new Error('Invalid credentials. Please check and try again.');
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
        this.error('Failed to generate vehicle link:', error);
        throw new Error('Failed to generate vehicle link. Please check your credentials.');
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

        // Map vehicles to Homey device format
        return vehicles.map(vehicle => ({
          name: vehicle.name || 'XPENG Vehicle',
          data: {
            id: vehicle.id
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
            'location'
          ]
        }));
      } catch (error) {
        this.error('Failed to list devices:', error);
        throw new Error('Failed to list devices: ' + error.message);
      }
    });
  }

  // Method to get stored credentials
  getStoredCredentials() {
    const clientId = this.homey.settings.get('enode_client_id');
    const clientSecret = this.homey.settings.get('enode_client_secret');
    
    this.log('Getting stored credentials:', {
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret
    });
    
    return {
      clientId,
      clientSecret
    };
  }
}

module.exports = XpengDriver;
