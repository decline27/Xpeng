'use strict';

const Homey = require('homey');
const Logger = require('./lib/logger'); // new logging module

module.exports = class XPengApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    try {
      this.log('XPeng Car Manager is running...');

      // Log current settings
      const currentClientId = this.homey.settings.get('enode_client_id');
      const currentClientSecret = this.homey.settings.get('enode_client_secret');
      
      this.log('Current settings status:', {
        hasClientId: !!currentClientId,
        hasClientSecret: !!currentClientSecret
      });

      // Initialize settings if not set already
      try {
        if (currentClientId == null) {
          this.log('Initializing enode_client_id setting');
          await this.homey.settings.set('enode_client_id', '');
        }
        
        if (currentClientSecret == null) {
          this.log('Initializing enode_client_secret setting');
          await this.homey.settings.set('enode_client_secret', '');
        }

        // Verify settings after initialization
        this.log('Settings verification:', {
          clientIdInitialized: this.homey.settings.get('enode_client_id') != null,
          clientSecretInitialized: this.homey.settings.get('enode_client_secret') != null
        });
      } catch (settingsError) {
        this.error('Error initializing settings:', settingsError);
      }

      Logger.log('XPENG app initialized');
      // Improved configuration: load sensitive config from environment variables
      this.clientId = process.env.ENODE_CLIENT_ID || 'default_client_id';
      this.clientSecret = process.env.ENODE_CLIENT_SECRET || 'default_client_secret';
    } catch (error) {
      Logger.error('Initialization error:', error);
    }
  }
};
