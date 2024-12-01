const Homey = require('homey');

class XpengCarDriver extends Homey.Driver {
  async onInit() {
    this.log('XpengCarDriver has been initialized');

    // Register Flow Actions
    this.homey.flow.getActionCard('start_charging')
      .registerRunListener(async (args, state) => {
        const device = args.device;
        await device.onActionStartCharging();
      });

    this.homey.flow.getActionCard('stop_charging')
      .registerRunListener(async (args, state) => {
        const device = args.device;
        await device.onActionStopCharging();
      });
  }

  async onPair(session) {
    session.setHandler('list_devices', async () => {
      return [
        {
          name: 'XPENG Car',
          data: {
            id: 'xpeng_car'
          }
        }
      ];
    });
  }
}

module.exports = XpengCarDriver;
