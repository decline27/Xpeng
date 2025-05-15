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
      // Load configuration from environment variables or settings (NO default values for security)
      this.clientId = process.env.ENODE_CLIENT_ID || this.homey.settings.get('enode_client_id');
      this.clientSecret = process.env.ENODE_CLIENT_SECRET || this.homey.settings.get('enode_client_secret');

      // Log security status (without exposing actual credentials)
      Logger.log('Credential status:', {
        hasEnvironmentClientId: !!process.env.ENODE_CLIENT_ID,
        hasSettingsClientId: !!this.homey.settings.get('enode_client_id'),
        ready: !!(this.clientId && this.clientSecret)
      });

      // Initialize client manager
      this.clientManager = new ClientManager(this.homey);

      // Initialize account manager (which uses client manager internally)
      this.accountManager = new AccountManager(this.homey);

      try {
        // Initialize primary and secondary clients from env.json or settings
        const primaryClientId = Homey.env.ENODE_CLIENT_ID || this.homey.settings.get('enode_client_id');
        const primaryClientSecret = Homey.env.ENODE_CLIENT_SECRET || this.homey.settings.get('enode_client_secret');

        const secondaryClientId = Homey.env.ENODE_CLIENT_ID_SECONDARY || this.homey.settings.get('enode_client_id_secondary') || '92a84316-6eed-462b-98f2-e212d3f0cd17';
        const secondaryClientSecret = Homey.env.ENODE_CLIENT_SECRET_SECONDARY || this.homey.settings.get('enode_client_secret_secondary') || '37c3a47b2f0153b9e4958661634c098ccbd15621';

        // Add primary client if credentials exist
        if (primaryClientId && primaryClientSecret) {
          this.clientManager.addClient(
            'primary',
            'Primary Client',
            primaryClientId,
            primaryClientSecret,
            true
          );
          Logger.log('Primary Enode client initialized');
        }

        // Add secondary client if credentials exist
        if (secondaryClientId && secondaryClientSecret) {
          this.clientManager.addClient(
            'secondary',
            'Secondary Client',
            secondaryClientId,
            secondaryClientSecret,
            true
          );
          Logger.log('Secondary Enode client initialized');
        }

        // Check for additional clients in env.json (format: ENODE_CLIENT_ID_3, ENODE_CLIENT_SECRET_3, etc.)
        // This allows for unlimited clients to be added
        for (let i = 3; i <= 10; i++) {
          const clientIdKey = `ENODE_CLIENT_ID_${i}`;
          const clientSecretKey = `ENODE_CLIENT_SECRET_${i}`;

          const clientId = Homey.env[clientIdKey];
          const clientSecret = Homey.env[clientSecretKey];

          if (clientId && clientSecret) {
            this.clientManager.addClient(
              `client_${i}`,
              `Enode Client ${i}`,
              clientId,
              clientSecret,
              false
            );
            Logger.log(`Additional Enode client ${i} initialized`);
          }
        }

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
    } catch (error) {
      Logger.error('Initialization error:', error);
    }
  }
};
