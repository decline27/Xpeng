const Homey = require('homey');
const ClientManager = require('./client-manager');

/**
 * AccountManager handles multiple Enode developer accounts
 * This allows the app to support both existing vehicles (account 1)
 * and new vehicles (account 2) seamlessly
 *
 * NOTE: This class is maintained for backward compatibility.
 * New code should use ClientManager directly for more flexibility.
 */
class AccountManager {
  constructor(homey) {
    this.homey = homey;
    this.logger = homey.log || console.log;

    // Account identifiers
    this.ACCOUNT_1 = 'primary';
    this.ACCOUNT_2 = 'secondary';

    // Settings keys
    this.SETTINGS_KEYS = {
      // Primary account (original)
      PRIMARY_CLIENT_ID: 'enode_client_id',
      PRIMARY_CLIENT_SECRET: 'enode_client_secret',

      // Secondary account (new)
      SECONDARY_CLIENT_ID: 'enode_client_id_secondary',
      SECONDARY_CLIENT_SECRET: 'enode_client_secret_secondary',

      // Vehicle account mapping
      VEHICLE_ACCOUNT_MAPPING: 'vehicle_account_mapping',

      // Default account for new vehicles
      DEFAULT_ACCOUNT: 'default_account'
    };

    // Initialize the client manager
    this.clientManager = new ClientManager(homey);

    // Initialize account mapping if not exists
    this._initializeMapping();
  }

  /**
   * Initialize the vehicle-to-account mapping if it doesn't exist
   * @private
   */
  _initializeMapping() {
    // For backward compatibility, ensure the old settings are still initialized
    const mapping = this.homey.settings.get(this.SETTINGS_KEYS.VEHICLE_ACCOUNT_MAPPING);
    if (!mapping) {
      this.homey.settings.set(this.SETTINGS_KEYS.VEHICLE_ACCOUNT_MAPPING, {});
    }

    // Set default account for new vehicles if not set
    const defaultAccount = this.homey.settings.get(this.SETTINGS_KEYS.DEFAULT_ACCOUNT);
    if (!defaultAccount) {
      // Initially set to secondary account for new vehicles
      this.homey.settings.set(this.SETTINGS_KEYS.DEFAULT_ACCOUNT, this.ACCOUNT_2);
    }
  }

  /**
   * Initialize the secondary account credentials
   * @param {string} clientId - The client ID for the secondary account
   * @param {string} clientSecret - The client secret for the secondary account
   */
  initializeSecondaryAccount(clientId, clientSecret) {
    if (!clientId || !clientSecret) {
      throw new Error('Both client ID and client secret are required');
    }

    // Set in both the old settings and the new client manager
    this.homey.settings.set(this.SETTINGS_KEYS.SECONDARY_CLIENT_ID, clientId);
    this.homey.settings.set(this.SETTINGS_KEYS.SECONDARY_CLIENT_SECRET, clientSecret);

    // Add to client manager
    this.clientManager.addClient(
      this.ACCOUNT_2,
      'Secondary Client',
      clientId,
      clientSecret,
      true
    );

    this.logger('Secondary account credentials initialized');
    return true;
  }

  /**
   * Get credentials for the specified account
   * @param {string} accountId - The account identifier (primary or secondary)
   * @returns {Object} The credentials object with clientId and clientSecret
   */
  getCredentials(accountId = null) {
    // If no account specified, use the default account
    if (!accountId) {
      accountId = this.getDefaultAccount();
    }

    // Use the client manager to get credentials
    try {
      const credentials = this.clientManager.getClientCredentials(accountId);
      return {
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        accountId: accountId
      };
    } catch (error) {
      // Fallback to legacy method for backward compatibility
      if (accountId === this.ACCOUNT_1) {
        // Get primary account credentials (from env.json or settings)
        const clientId = Homey.env.ENODE_CLIENT_ID ||
                        this.homey.settings.get(this.SETTINGS_KEYS.PRIMARY_CLIENT_ID);
        const clientSecret = Homey.env.ENODE_CLIENT_SECRET ||
                            this.homey.settings.get(this.SETTINGS_KEYS.PRIMARY_CLIENT_SECRET);

        return { clientId, clientSecret, accountId: this.ACCOUNT_1 };
      } else if (accountId === this.ACCOUNT_2) {
        // Get secondary account credentials (from env.json or settings)
        const clientId = Homey.env.ENODE_CLIENT_ID_SECONDARY ||
                        this.homey.settings.get(this.SETTINGS_KEYS.SECONDARY_CLIENT_ID);
        const clientSecret = Homey.env.ENODE_CLIENT_SECRET_SECONDARY ||
                            this.homey.settings.get(this.SETTINGS_KEYS.SECONDARY_CLIENT_SECRET);

        return { clientId, clientSecret, accountId: this.ACCOUNT_2 };
      } else {
        throw new Error(`Unknown account ID: ${accountId}`);
      }
    }
  }

  /**
   * Get the default account for new vehicles
   * @returns {string} The default account ID
   */
  getDefaultAccount() {
    // Use client manager's default client
    try {
      return this.clientManager.getDefaultClient();
    } catch (error) {
      // Fallback to legacy method
      return this.homey.settings.get(this.SETTINGS_KEYS.DEFAULT_ACCOUNT) || this.ACCOUNT_2;
    }
  }

  /**
   * Set the default account for new vehicles
   * @param {string} accountId - The account identifier (primary or secondary)
   */
  setDefaultAccount(accountId) {
    if (accountId !== this.ACCOUNT_1 && accountId !== this.ACCOUNT_2) {
      throw new Error(`Invalid account ID: ${accountId}`);
    }

    // Set in both old settings and client manager
    this.homey.settings.set(this.SETTINGS_KEYS.DEFAULT_ACCOUNT, accountId);

    try {
      this.clientManager.setDefaultClient(accountId);
    } catch (error) {
      this.logger(`Error setting default client: ${error.message}`);
    }

    this.logger(`Default account set to: ${accountId}`);
  }

  /**
   * Associate a vehicle with a specific account
   * @param {string} vehicleId - The vehicle ID or VIN
   * @param {string} accountId - The account identifier (primary or secondary)
   */
  setVehicleAccount(vehicleId, accountId) {
    if (!vehicleId) {
      throw new Error('Vehicle ID is required');
    }

    if (accountId !== this.ACCOUNT_1 && accountId !== this.ACCOUNT_2) {
      throw new Error(`Invalid account ID: ${accountId}`);
    }

    // Set in both old settings and client manager
    const mapping = this.homey.settings.get(this.SETTINGS_KEYS.VEHICLE_ACCOUNT_MAPPING) || {};
    mapping[vehicleId] = accountId;
    this.homey.settings.set(this.SETTINGS_KEYS.VEHICLE_ACCOUNT_MAPPING, mapping);

    try {
      this.clientManager.setVehicleClient(vehicleId, accountId);
    } catch (error) {
      this.logger(`Error setting vehicle client: ${error.message}`);
    }

    this.logger(`Vehicle ${vehicleId} associated with account: ${accountId}`);
  }

  /**
   * Get the account associated with a vehicle
   * @param {string} vehicleId - The vehicle ID or VIN
   * @returns {string} The account identifier
   */
  getVehicleAccount(vehicleId) {
    if (!vehicleId) {
      return this.getDefaultAccount();
    }

    // Try client manager first
    try {
      return this.clientManager.getVehicleClient(vehicleId);
    } catch (error) {
      // Fallback to legacy method
      const mapping = this.homey.settings.get(this.SETTINGS_KEYS.VEHICLE_ACCOUNT_MAPPING) || {};
      return mapping[vehicleId] || this.getDefaultAccount();
    }
  }

  /**
   * Get credentials for a specific vehicle
   * @param {string} vehicleId - The vehicle ID or VIN
   * @returns {Object} The credentials object
   */
  getVehicleCredentials(vehicleId) {
    // Try client manager first
    try {
      const credentials = this.clientManager.getVehicleCredentials(vehicleId);
      return {
        clientId: credentials.clientId,
        clientSecret: credentials.clientSecret,
        accountId: credentials.clientIdentifier
      };
    } catch (error) {
      // Fallback to legacy method
      const accountId = this.getVehicleAccount(vehicleId);
      return this.getCredentials(accountId);
    }
  }

  /**
   * Check if both accounts are properly configured
   * @returns {Object} Status of both accounts
   */
  checkAccountsStatus() {
    // Try client manager first
    try {
      const clientStatus = this.clientManager.checkClientsStatus();

      // Extract primary and secondary status for backward compatibility
      const primaryClient = clientStatus.clients[this.ACCOUNT_1] || { isConfigured: false };
      const secondaryClient = clientStatus.clients[this.ACCOUNT_2] || { isConfigured: false };

      return {
        primaryConfigured: primaryClient.isConfigured,
        secondaryConfigured: secondaryClient.isConfigured,
        totalClients: clientStatus.totalClients,
        configuredClients: clientStatus.configuredClients
      };
    } catch (error) {
      // Fallback to legacy method
      const primaryCreds = this.getCredentials(this.ACCOUNT_1);
      const secondaryCreds = this.getCredentials(this.ACCOUNT_2);

      return {
        primaryConfigured: !!(primaryCreds.clientId && primaryCreds.clientSecret),
        secondaryConfigured: !!(secondaryCreds.clientId && secondaryCreds.clientSecret)
      };
    }
  }
}

module.exports = AccountManager;
