'use strict';

const Homey = require('homey');
const Logger = require('./lib/logger'); // new logging module
const SettingsManager = require('./lib/settingsManager');
const AccountManager = require('./lib/account-manager');
const ClientManager = require('./lib/client-manager');

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

      // Initialize client manager
      this.clientManager = new ClientManager(this.homey);

      // Initialize account manager (which uses client manager internally)
      this.accountManager = new AccountManager(this.homey);

      try {
        // Check client status
        const clientStatus = this.clientManager.checkClientsStatus();
        Logger.log('Enode clients status:', {
          totalClients: clientStatus.totalClients,
          configuredClients: clientStatus.configuredClients,
          defaultClient: this.clientManager.getDefaultClient()
        });

        // For backward compatibility, also log account status
        const accountStatus = this.accountManager.checkAccountsStatus();
        Logger.log('Enode accounts status (legacy):', {
          primaryConfigured: accountStatus.primaryConfigured,
          secondaryConfigured: accountStatus.secondaryConfigured,
          defaultAccount: this.accountManager.getDefaultAccount()
        });
      } catch (error) {
        Logger.error('Error initializing Enode clients:', error);
      }

      // Register flow actions for advanced analytics
      this.registerFlowActions();

    } catch (error) {
      Logger.error('Initialization error:', error);
    }
  }

  /**
   * Register flow actions for advanced analytics features
   */
  registerFlowActions() {
    try {
      // Register predict range flow action
      this.homey.flow.getActionCard('predict_range')
        .registerRunListener(async (args) => {
          try {
            const device = args.device;
            const predictedRange = await device.predictRange();
            
            Logger.log(`Range prediction for ${device.getName()}: ${predictedRange} km`);
            
            return {
              predicted_range: predictedRange
            };
          } catch (error) {
            Logger.error('Error in predict_range flow action:', error);
            throw new Error(`Failed to predict range: ${error.message}`);
          }
        });

      // Register predict charging time flow action
      this.homey.flow.getActionCard('predict_charging_time')
        .registerRunListener(async (args) => {
          try {
            const device = args.device;
            const chargingTimeMinutes = await device.predictChargingTime();
            const chargingTimeHours = Math.round((chargingTimeMinutes / 60) * 100) / 100;
            
            Logger.log(`Charging time prediction for ${device.getName()}: ${chargingTimeMinutes} minutes (${chargingTimeHours} hours)`);
            
            return {
              charging_time_minutes: chargingTimeMinutes,
              charging_time_hours: chargingTimeHours
            };
          } catch (error) {
            Logger.error('Error in predict_charging_time flow action:', error);
            throw new Error(`Failed to predict charging time: ${error.message}`);
          }
        });

      Logger.log('Advanced analytics flow actions registered successfully');
    } catch (error) {
      Logger.error('Error registering flow actions:', error);
    }
  }
};
