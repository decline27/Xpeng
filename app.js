'use strict';

const Homey = require('homey');
const Logger = require('./lib/logger');
const SettingsManager = require('./lib/settingsManager');

module.exports = class XPengApp extends Homey.App {
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
      // Improved configuration: load sensitive config from environment variables
      this.clientId = process.env.ENODE_CLIENT_ID || 'default_client_id';
      this.clientSecret = process.env.ENODE_CLIENT_SECRET || 'default_client_secret';
    } catch (error) {
      Logger.error('Initialization error:', error);
    }
  }
};
