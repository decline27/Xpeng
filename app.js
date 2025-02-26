'use strict';

const Homey = require('homey');
const Logger = require('./lib/logger'); // new logging module
const SettingsManager = require('./lib/settingsManager');

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

      // Initialize settings if not set already using SettingsManager
      try {
        await SettingsManager.initializeSettings(this.homey, Logger);
      } catch (settingsError) {
        Logger.error('Error initializing settings:', settingsError);
      }

      Logger.log('XPENG app initialized');
      // Load configuration from environment variables or settings (NO default values for security)
      this.clientId = process.env.ENODE_CLIENT_ID || this.homey.settings.get('enode_client_id');
      this.clientSecret = process.env.ENODE_CLIENT_SECRET || this.homey.settings.get('enode_client_secret');
      
      // Log security status (without exposing actual credentials)
      Logger.log('Credential status:', {
        hasEnvironmentClientId: !!process.env.ENODE_CLIENT_ID,
        hasSettingsClientId: !!this.homey.settings.get('enode_client_id'),
        ready: !!(this.clientId && this.clientSecret)
      });
    } catch (error) {
      Logger.error('Initialization error:', error);
    }
  }
};
