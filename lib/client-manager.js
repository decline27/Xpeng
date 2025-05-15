const Homey = require('homey');

/**
 * ClientManager handles multiple Enode clients under one developer account
 * This allows the app to support more than 25 vehicles by using multiple clients
 */
class ClientManager {
  constructor(homey) {
    this.homey = homey;
    this.logger = homey.log || console.log;

    // Settings keys
    this.SETTINGS_KEYS = {
      // Client credentials
      CLIENTS: 'enode_clients',

      // Vehicle client mapping
      VEHICLE_CLIENT_MAPPING: 'vehicle_client_mapping',

      // Default client for new vehicles
      DEFAULT_CLIENT: 'default_client'
    };

    // Initialize client list and mapping if not exists
    this._initialize();
  }

  /**
   * Initialize the client manager
   * @private
   */
  _initialize() {
    // Initialize clients list if it doesn't exist
    const clients = this.homey.settings.get(this.SETTINGS_KEYS.CLIENTS);
    if (!clients) {
      // Create initial clients list with primary and secondary clients
      const initialClients = {
        'primary': {
          clientId: Homey.env.ENODE_CLIENT_ID || this.homey.settings.get('enode_client_id'),
          clientSecret: Homey.env.ENODE_CLIENT_SECRET || this.homey.settings.get('enode_client_secret'),
          name: 'Primary Client',
          isDefault: true
        },
        'secondary': {
          clientId: Homey.env.ENODE_CLIENT_ID_SECONDARY || this.homey.settings.get('enode_client_id_secondary'),
          clientSecret: Homey.env.ENODE_CLIENT_SECRET_SECONDARY || this.homey.settings.get('enode_client_secret_secondary'),
          name: 'Secondary Client',
          isDefault: false
        }
      };

      this.homey.settings.set(this.SETTINGS_KEYS.CLIENTS, initialClients);
      this.logger('Initialized clients list with primary and secondary clients');
    }

    // Initialize vehicle-to-client mapping if it doesn't exist
    const mapping = this.homey.settings.get(this.SETTINGS_KEYS.VEHICLE_CLIENT_MAPPING);
    if (!mapping) {
      this.homey.settings.set(this.SETTINGS_KEYS.VEHICLE_CLIENT_MAPPING, {});
    }

    // Set default client for new vehicles if not set
    const defaultClient = this.homey.settings.get(this.SETTINGS_KEYS.DEFAULT_CLIENT);
    if (!defaultClient) {
      // Initially set to secondary client for new vehicles since primary may be at capacity
      this.homey.settings.set(this.SETTINGS_KEYS.DEFAULT_CLIENT, 'secondary');
    }

    // Migrate from old account manager if needed
    this.migrateFromAccountManager();
  }

  /**
   * Get credentials for the specified client
   * @param {string} clientId - The client identifier
   * @returns {Object} The credentials object with clientId and clientSecret
   */
  getClientCredentials(clientId = null) {
    // If no client specified, use the default client
    if (!clientId) {
      clientId = this.getDefaultClient();
    }

    const clients = this.homey.settings.get(this.SETTINGS_KEYS.CLIENTS) || {};

    if (!clients[clientId]) {
      throw new Error(`Unknown client ID: ${clientId}`);
    }

    return {
      clientId: clients[clientId].clientId,
      clientSecret: clients[clientId].clientSecret,
      name: clients[clientId].name,
      clientIdentifier: clientId
    };
  }

  /**
   * Get the default client for new vehicles
   * @returns {string} The default client ID
   */
  getDefaultClient() {
    return this.homey.settings.get(this.SETTINGS_KEYS.DEFAULT_CLIENT) || 'primary';
  }

  /**
   * Associate a vehicle with a specific client
   * @param {string} vehicleId - The vehicle ID or VIN
   * @param {string} clientId - The client identifier
   */
  setVehicleClient(vehicleId, clientId) {
    if (!vehicleId) {
      throw new Error('Vehicle ID is required');
    }

    const clients = this.homey.settings.get(this.SETTINGS_KEYS.CLIENTS) || {};

    if (!clients[clientId]) {
      throw new Error(`Invalid client ID: ${clientId}`);
    }

    const mapping = this.homey.settings.get(this.SETTINGS_KEYS.VEHICLE_CLIENT_MAPPING) || {};
    mapping[vehicleId] = clientId;

    this.homey.settings.set(this.SETTINGS_KEYS.VEHICLE_CLIENT_MAPPING, mapping);
    this.logger(`Vehicle ${vehicleId} associated with client: ${clientId}`);
  }

  /**
   * Get the client associated with a vehicle
   * @param {string} vehicleId - The vehicle ID or VIN
   * @returns {string} The client identifier
   */
  getVehicleClient(vehicleId) {
    if (!vehicleId) {
      return this.getDefaultClient();
    }

    const mapping = this.homey.settings.get(this.SETTINGS_KEYS.VEHICLE_CLIENT_MAPPING) || {};

    // If vehicle is not in mapping, use default client
    return mapping[vehicleId] || this.getDefaultClient();
  }

  /**
   * Get credentials for a specific vehicle
   * @param {string} vehicleId - The vehicle ID or VIN
   * @returns {Object} The credentials object
   */
  getVehicleCredentials(vehicleId) {
    const clientId = this.getVehicleClient(vehicleId);
    return this.getClientCredentials(clientId);
  }

  /**
   * Find an available client that hasn't reached capacity
   * @param {number} capacity - The maximum capacity per client (default: 25)
   * @returns {string} The client identifier, or null if all clients are at capacity
   */
  findAvailableClient(capacity = 25) {
    const counts = this.getClientVehicleCounts();
    const clients = this.homey.settings.get(this.SETTINGS_KEYS.CLIENTS) || {};

    // First try the default client
    const defaultClient = this.getDefaultClient();
    if (counts[defaultClient] < capacity) {
      return defaultClient;
    }

    // Then try to find any client with capacity
    for (const clientId of Object.keys(clients)) {
      if (counts[clientId] < capacity) {
        return clientId;
      }
    }

    // If all clients are at capacity, return null
    return null;
  }

  /**
   * Get the number of vehicles associated with each client
   * @returns {Object} Map of client IDs to vehicle counts
   */
  getClientVehicleCounts() {
    const mapping = this.homey.settings.get(this.SETTINGS_KEYS.VEHICLE_CLIENT_MAPPING) || {};
    const counts = {};

    // Initialize counts for all clients
    const clients = this.homey.settings.get(this.SETTINGS_KEYS.CLIENTS) || {};
    Object.keys(clients).forEach(clientId => {
      counts[clientId] = 0;
    });

    // Count vehicles for each client
    Object.values(mapping).forEach(clientId => {
      if (counts[clientId] !== undefined) {
        counts[clientId]++;
      }
    });

    return counts;
  }

  /**
   * Migrate data from the old AccountManager format
   * @returns {boolean} True if migration was successful
   */
  migrateFromAccountManager() {
    try {
      // Check if we need to migrate
      const oldMapping = this.homey.settings.get('vehicle_account_mapping');
      if (!oldMapping) {
        return false; // Nothing to migrate
      }

      // Get the new mapping
      const newMapping = this.homey.settings.get(this.SETTINGS_KEYS.VEHICLE_CLIENT_MAPPING) || {};

      // Map old account IDs to new client IDs
      const accountToClientMap = {
        'primary': 'primary',
        'secondary': 'secondary'
      };

      // Migrate vehicle mappings
      Object.entries(oldMapping).forEach(([vehicleId, accountId]) => {
        const clientId = accountToClientMap[accountId] || 'primary';
        newMapping[vehicleId] = clientId;
      });

      // Save the new mapping
      this.homey.settings.set(this.SETTINGS_KEYS.VEHICLE_CLIENT_MAPPING, newMapping);

      // Log the migration
      this.logger(`Migrated ${Object.keys(oldMapping).length} vehicles from AccountManager to ClientManager`);

      return true;
    } catch (error) {
      this.logger('Error migrating from AccountManager:', error);
      return false;
    }
  }
}

module.exports = ClientManager;
