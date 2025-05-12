'use strict';

const Homey = require('homey');
const Logger = require('./lib/logger'); // new logging module
const SettingsManager = require('./lib/settingsManager');
const AccountManager = require('./lib/account-manager');

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

      // Initialize account manager and set up secondary account
      this.accountManager = new AccountManager(this.homey);

      // Initialize secondary account with the new credentials from env.json or hardcoded values
      const secondaryClientId = Homey.env.ENODE_CLIENT_ID_SECONDARY || '92a84316-6eed-462b-98f2-e212d3f0cd17';
      const secondaryClientSecret = Homey.env.ENODE_CLIENT_SECRET_SECONDARY || '37c3a47b2f0153b9e4958661634c098ccbd15621';

      try {
        // Only set if not already configured
        const secondaryConfigured = this.homey.settings.get('enode_client_id_secondary');
        if (!secondaryConfigured) {
          this.accountManager.initializeSecondaryAccount(secondaryClientId, secondaryClientSecret);
          Logger.log('Secondary Enode account initialized successfully');
        } else {
          Logger.log('Secondary Enode account already configured');
        }

        // Check account status
        const accountStatus = this.accountManager.checkAccountsStatus();
        Logger.log('Enode accounts status:', {
          primaryConfigured: accountStatus.primaryConfigured,
          secondaryConfigured: accountStatus.secondaryConfigured,
          defaultAccount: this.accountManager.getDefaultAccount()
        });
      } catch (accountError) {
        Logger.error('Error initializing secondary account:', accountError);
      }
    } catch (error) {
      Logger.error('Initialization error:', error);
    }
  }
};
