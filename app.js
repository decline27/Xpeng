'use strict';

const Homey = require('homey');

module.exports = class MyApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('XPeng Car Manager is running...');

    // Initialize settings if they don't exist
    if (!this.homey.settings.get('enode_client_id')) {
      this.homey.settings.set('enode_client_id', '');
    }
    if (!this.homey.settings.get('enode_client_secret')) {
      this.homey.settings.set('enode_client_secret', '');
    }
  }

};
