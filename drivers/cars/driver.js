const Homey = require('homey');
const EnodeAPI = require('../../lib/enode-api');

class XpengDriver extends Homey.Driver {
  async onInit() {
    this.log('XPeng Driver has been initialized');
    this.enodeApi = new EnodeAPI(this.homey);
    
    // Initialize driver storage
    this.clientId = null;
    this.clientSecret = null;

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
    session.setHandler('save_credentials', async (data) => {
      this.clientId = data.clientId;
      this.clientSecret = data.clientSecret;
      return true;
    });

    session.setHandler('get_link', async () => {
      try {
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
            id: vehicle.id,
            clientId: this.clientId,
            clientSecret: this.clientSecret
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
}

module.exports = XpengDriver;
