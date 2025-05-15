const Homey = require('homey');

/**
 * ClientManager handles multiple Enode clients
 * This allows the app to support unlimited clients for scaling beyond the 25-vehicle limit per client
 */
class ClientManager {
  constructor(homey) {
    this.homey = homey;
    this.logger = homey.log || console.log;

    // Settings keys
    this.SETTINGS_KEYS = {
      // Client registry - stores all client information
      CLIENT_REGISTRY: 'enode_client_registry',

      // Vehicle client mapping
      VEHICLE_CLIENT_MAPPING: 'vehicle_client_mapping',

      // Default client for new vehicles
      DEFAULT_CLIENT: 'default_client'
    };

    // Client identifiers for backward compatibility
    this.LEGACY_CLIENTS = {
      PRIMARY: 'primary',
      SECONDARY: 'secondary'
    };

    // Initialize client registry if not exists
    this._initializeRegistry();
  }

  /**
   * Initialize the client registry if it doesn't exist
   * @private
   */
  _initializeRegistry() {
    const registry = this.homey.settings.get(this.SETTINGS_KEYS.CLIENT_REGISTRY);
    if (!registry) {
      // Create initial registry with primary and secondary clients for backward compatibility
      const initialRegistry = {
        // Use array for future sorting/filtering capabilities
        clients: []
      };
      this.homey.settings.set(this.SETTINGS_KEYS.CLIENT_REGISTRY, initialRegistry);
    }

    // Initialize vehicle-to-client mapping if it doesn't exist
    const mapping = this.homey.settings.get(this.SETTINGS_KEYS.VEHICLE_CLIENT_MAPPING);
    if (!mapping) {
      this.homey.settings.set(this.SETTINGS_KEYS.VEHICLE_CLIENT_MAPPING, {});
    }

    // Set default client for new vehicles if not set
    const defaultClient = this.homey.settings.get(this.SETTINGS_KEYS.DEFAULT_CLIENT);
    if (!defaultClient) {
      // Initially set to secondary client ID for new vehicles
      this._migrateAndSetDefaultClient();
    }
  }

  /**
   * Migrate existing primary and secondary clients to the new registry format
   * and set the default client
   * @private
   */
  _migrateAndSetDefaultClient() {
    try {
      // Get existing credentials from env.json or settings
      const primaryClientId = Homey.env.ENODE_CLIENT_ID ||
                             this.homey.settings.get('enode_client_id');
      const primaryClientSecret = Homey.env.ENODE_CLIENT_SECRET ||
                                 this.homey.settings.get('enode_client_secret');

      const secondaryClientId = Homey.env.ENODE_CLIENT_ID_SECONDARY ||
                               this.homey.settings.get('enode_client_id_secondary');
      const secondaryClientSecret = Homey.env.ENODE_CLIENT_SECRET_SECONDARY ||
                                   this.homey.settings.get('enode_client_secret_secondary');

      // Add primary client if credentials exist
      if (primaryClientId && primaryClientSecret) {
        this.addClient(
          this.LEGACY_CLIENTS.PRIMARY,
          'Primary Client',
          primaryClientId,
          primaryClientSecret,
          true
        );
      }

      // Add secondary client if credentials exist
      if (secondaryClientId && secondaryClientSecret) {
        this.addClient(
          this.LEGACY_CLIENTS.SECONDARY,
          'Secondary Client',
          secondaryClientId,
          secondaryClientSecret,
          true
        );

        // Set secondary as default for new vehicles (matching previous behavior)
        this.homey.settings.set(this.SETTINGS_KEYS.DEFAULT_CLIENT, this.LEGACY_CLIENTS.SECONDARY);
      } else if (primaryClientId && primaryClientSecret) {
        // If no secondary client, set primary as default
        this.homey.settings.set(this.SETTINGS_KEYS.DEFAULT_CLIENT, this.LEGACY_CLIENTS.PRIMARY);
      }
    } catch (error) {
      this.logger('Error during client migration:', error);
    }
  }

  /**
   * Add a new client to the registry
   * @param {string} clientId - The client identifier (for internal use)
   * @param {string} name - Human-readable name for the client
   * @param {string} enodeClientId - The Enode client ID
   * @param {string} enodeClientSecret - The Enode client secret
   * @param {boolean} isLegacy - Whether this is a legacy client (primary/secondary)
   * @returns {boolean} Success status
   */
  addClient(clientId, name, enodeClientId, enodeClientSecret, isLegacy = false) {
    if (!clientId || !name || !enodeClientId || !enodeClientSecret) {
      throw new Error('All client parameters are required');
    }

    const registry = this.homey.settings.get(this.SETTINGS_KEYS.CLIENT_REGISTRY) || { clients: [] };

    // Check if client already exists
    const existingClientIndex = registry.clients.findIndex(c => c.id === clientId);

    const clientData = {
      id: clientId,
      name: name,
      enodeClientId: enodeClientId,
      enodeClientSecret: enodeClientSecret,
      isLegacy: isLegacy,
      addedAt: new Date().toISOString(),
      vehicleCount: 0 // Will be updated when vehicles are associated
    };

    if (existingClientIndex >= 0) {
      // Update existing client
      registry.clients[existingClientIndex] = {
        ...registry.clients[existingClientIndex],
        ...clientData,
        updatedAt: new Date().toISOString()
      };
    } else {
      // Add new client
      registry.clients.push(clientData);
    }

    this.homey.settings.set(this.SETTINGS_KEYS.CLIENT_REGISTRY, registry);
    this.logger(`Client ${clientId} added/updated in registry`);
    return true;
  }

  /**
   * Remove a client from the registry
   * @param {string} clientId - The client identifier to remove
   * @returns {boolean} Success status
   */
  removeClient(clientId) {
    if (!clientId) {
      throw new Error('Client ID is required');
    }

    // Don't allow removing legacy clients
    if (clientId === this.LEGACY_CLIENTS.PRIMARY || clientId === this.LEGACY_CLIENTS.SECONDARY) {
      throw new Error('Cannot remove legacy clients');
    }

    const registry = this.homey.settings.get(this.SETTINGS_KEYS.CLIENT_REGISTRY) || { clients: [] };

    // Filter out the client to remove
    registry.clients = registry.clients.filter(c => c.id !== clientId);

    this.homey.settings.set(this.SETTINGS_KEYS.CLIENT_REGISTRY, registry);
    this.logger(`Client ${clientId} removed from registry`);
    return true;
  }

  /**
   * Get all registered clients
   * @returns {Array} Array of client objects
   */
  getAllClients() {
    const registry = this.homey.settings.get(this.SETTINGS_KEYS.CLIENT_REGISTRY) || { clients: [] };
    return registry.clients;
  }

  /**
   * Get a specific client by ID
   * @param {string} clientId - The client identifier
   * @returns {Object|null} The client object or null if not found
   */
  getClient(clientId) {
    if (!clientId) {
      return null;
    }

    const registry = this.homey.settings.get(this.SETTINGS_KEYS.CLIENT_REGISTRY) || { clients: [] };
    return registry.clients.find(c => c.id === clientId) || null;
  }

  /**
   * Get credentials for a specific client
   * @param {string} clientId - The client identifier
   * @returns {Object} The credentials object with enodeClientId and enodeClientSecret
   */
  getClientCredentials(clientId = null) {
    // If no client specified, use the default client
    if (!clientId) {
      clientId = this.getDefaultClient();
    }

    const client = this.getClient(clientId);

    if (!client) {
      throw new Error(`Unknown client ID: ${clientId}`);
    }

    return {
      clientId: client.enodeClientId,
      clientSecret: client.enodeClientSecret,
      clientIdentifier: client.id
    };
  }

  /**
   * Get the best client for a new vehicle
   * This fills each client to 25 vehicles before moving to the next one
   * @returns {string} The client ID to use
   */
  getClientForNewVehicle() {
    // Get all clients
    const registry = this.homey.settings.get(this.SETTINGS_KEYS.CLIENT_REGISTRY) || { clients: [] };
    const clients = registry.clients || [];

    if (clients.length === 0) {
      return this.LEGACY_CLIENTS.PRIMARY;
    }

    // Get vehicle-client mapping to count vehicles per client
    const mapping = this.homey.settings.get(this.SETTINGS_KEYS.VEHICLE_CLIENT_MAPPING) || {};

    // Count vehicles per client
    const vehicleCounts = {};
    clients.forEach(client => {
      vehicleCounts[client.id] = 0;
    });

    // Count existing vehicles
    Object.values(mapping).forEach(clientId => {
      if (vehicleCounts[clientId] !== undefined) {
        vehicleCounts[clientId]++;
      }
    });

    // Find the first client that isn't full (less than 25 vehicles)
    const MAX_VEHICLES_PER_CLIENT = 25;

    // Sort clients to ensure we fill in order (primary, secondary, client_3, etc.)
    const sortedClients = [...clients].sort((a, b) => {
      // Primary first
      if (a.id === this.LEGACY_CLIENTS.PRIMARY) return -1;
      if (b.id === this.LEGACY_CLIENTS.PRIMARY) return 1;
      // Secondary second
      if (a.id === this.LEGACY_CLIENTS.SECONDARY) return -1;
      if (b.id === this.LEGACY_CLIENTS.SECONDARY) return 1;
      // Then by client ID (assuming format like client_3, client_4, etc.)
      return a.id.localeCompare(b.id);
    });

    for (const client of sortedClients) {
      const count = vehicleCounts[client.id] || 0;
      if (count < MAX_VEHICLES_PER_CLIENT) {
        this.logger(`Selected client ${client.id} with ${count}/${MAX_VEHICLES_PER_CLIENT} vehicles for new vehicle`);
        return client.id;
      }
    }

    // If all clients are full, use the last one as fallback
    const lastClient = sortedClients[sortedClients.length - 1];
    this.logger(`All clients are full, using ${lastClient.id} as fallback`);
    return lastClient.id;
  }

  /**
   * Get the default client for new vehicles
   * @returns {string} The default client ID
   */
  getDefaultClient() {
    // Check if a default client is explicitly set in settings
    const defaultClient = this.homey.settings.get(this.SETTINGS_KEYS.DEFAULT_CLIENT);
    if (defaultClient) {
      return defaultClient;
    }

    // Otherwise, use the fill-to-capacity strategy
    return this.getClientForNewVehicle();
  }

  /**
   * Set the default client for new vehicles
   * @param {string} clientId - The client identifier
   */
  setDefaultClient(clientId) {
    if (!clientId) {
      throw new Error('Client ID is required');
    }

    // Verify client exists
    const client = this.getClient(clientId);
    if (!client) {
      throw new Error(`Invalid client ID: ${clientId}`);
    }

    this.homey.settings.set(this.SETTINGS_KEYS.DEFAULT_CLIENT, clientId);
    this.logger(`Default client set to: ${clientId}`);
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

    // Verify client exists
    const client = this.getClient(clientId);
    if (!client) {
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
   * Check if all clients are properly configured
   * @returns {Object} Status of all clients
   */
  checkClientsStatus() {
    const clients = this.getAllClients();
    const status = {
      totalClients: clients.length,
      configuredClients: 0,
      clients: {}
    };

    clients.forEach(client => {
      const isConfigured = !!(client.enodeClientId && client.enodeClientSecret);
      status.clients[client.id] = {
        name: client.name,
        isConfigured: isConfigured
      };

      if (isConfigured) {
        status.configuredClients++;
      }
    });

    return status;
  }
}

module.exports = ClientManager;
