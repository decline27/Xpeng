const Homey = require('homey');

// Client secrets are kept in memory only. They come from env.json on every start, so they
// never need to be written to the persistent settings (which end up in backups).
const secretsByHomey = new WeakMap();

/**
 * ClientManager handles multiple Enode clients
 * Capacity is enforced by Enode, independently of this Homey's vehicle mappings.
 */
class ClientManager {
  constructor(homey) {
    this.homey = homey;
    this.logger = homey.log || console.log;
    if (!secretsByHomey.has(homey)) secretsByHomey.set(homey, new Map());
    this.clientSecrets = secretsByHomey.get(homey);

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
    this.initializeConfiguredClients();
  }

  /**
   * Initialize the client registry if it doesn't exist
   * @private
   */
  _initializeRegistry() {
    const registry = this.homey.settings.get(this.SETTINGS_KEYS.CLIENT_REGISTRY);

    // Older versions stored secrets in settings: keep them for this run, remove them from storage
    if (registry && Array.isArray(registry.clients) && registry.clients.some(c => c.enodeClientSecret)) {
      registry.clients = registry.clients.map(({ enodeClientSecret, ...client }) => {
        if (enodeClientSecret && !this.clientSecrets.has(client.id)) {
          this.clientSecrets.set(client.id, enodeClientSecret);
        }
        return client;
      });
      this.homey.settings.set(this.SETTINGS_KEYS.CLIENT_REGISTRY, registry);
    }

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
  }

  /**
   * Reload credentials on every start, including installations with a saved default.
   * Numbered clients can have gaps and are not limited to ten entries.
   */
  initializeConfiguredClients() {
    const env = Homey.env || {};
    const definitions = [
      { id: 'primary', suffix: '', name: 'Primary Client', legacy: true },
      { id: 'secondary', suffix: '_SECONDARY', name: 'Secondary Client', legacy: true, secondary: true },
      ...Object.keys(env)
        .map(key => /^ENODE_CLIENT_ID_(\d+)$/.exec(key))
        .filter(match => match && Number(match[1]) >= 3)
        .sort((a, b) => Number(a[1]) - Number(b[1]))
        .map(match => ({ id: `client_${match[1]}`, suffix: `_${match[1]}`, name: `Enode Client ${match[1]}` }))
    ];
    for (const entry of definitions) {
      let clientId = env[`ENODE_CLIENT_ID${entry.suffix}`];
      let clientSecret = env[`ENODE_CLIENT_SECRET${entry.suffix}`];
      // Never combine half of an environment credential pair with an older setting.
      if (!clientId && !clientSecret && entry.legacy) {
        const suffix = entry.secondary ? '_secondary' : '';
        clientId = this.homey.settings.get(`enode_client_id${suffix}`);
        clientSecret = this.homey.settings.get(`enode_client_secret${suffix}`);
      }
      if (clientId && clientSecret) {
        const existing = this.getClient(entry.id);
        if (existing?.enodeClientId !== clientId || existing?.enodeClientSecret !== clientSecret) {
          this.addClient(entry.id, entry.name, clientId, clientSecret, !!entry.legacy);
        }
      }
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

    this.clientSecrets.set(clientId, enodeClientSecret);

    const clientData = {
      id: clientId,
      name: name,
      enodeClientId: enodeClientId,
      isLegacy: isLegacy,
      addedAt: new Date().toISOString(),
      vehicleCount: 0 // Will be updated when vehicles are associated
    };

    if (existingClientIndex >= 0) {
      // Update existing client
      registry.clients[existingClientIndex] = {
        ...registry.clients[existingClientIndex],
        ...clientData,
        enodeClientSecret: undefined,
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
   * Remove stale clients from the registry that are no longer configured
   * @param {Array<string>} validClientIds - List of currently valid client IDs
   */
  removeStaleClients(validClientIds) {
    const registry = this.homey.settings.get(this.SETTINGS_KEYS.CLIENT_REGISTRY) || { clients: [] };
    const before = registry.clients.length;
    registry.clients = registry.clients.filter(c => validClientIds.includes(c.id));
    const removed = before - registry.clients.length;
    if (removed > 0) {
      this.homey.settings.set(this.SETTINGS_KEYS.CLIENT_REGISTRY, registry);
      this.logger(`Removed ${removed} stale client(s) from registry`);
    }
  }

  /**
   * Get all registered clients
   * @returns {Array} Array of client objects
   */
  getAllClients() {
    const registry = this.homey.settings.get(this.SETTINGS_KEYS.CLIENT_REGISTRY) || { clients: [] };
    return (registry.clients || []).map(client => this._withSecret(client));
  }

  /**
   * Attach the in-memory secret to a stored client record.
   * @private
   */
  _withSecret(client) {
    if (!client) return client;
    return { ...client, enodeClientSecret: this.clientSecrets.get(client.id) || client.enodeClientSecret };
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
    return this._withSecret(registry.clients.find(c => c.id === clientId)) || null;
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
   * Start with the first configured client. Link generation tries the others when
   * Enode rejects a new link. Local VIN/id mappings cannot measure shared capacity.
   * @returns {string} client identifier
   */
  getClientForNewVehicle() {
    const rank = id => id === 'primary' ? 0 : id === 'secondary' ? 1 : 2;
    const clients = this.getAllClients()
      .filter(client => client.enodeClientId && client.enodeClientSecret)
      .sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id, 'en', { numeric: true }));
    return clients[0]?.id || this.LEGACY_CLIENTS.PRIMARY;
  }

  /**
   * Get the default client for new vehicles
   * @returns {string} The default client ID
   */
  getDefaultClient() {
    // Check if a default client is explicitly set in settings
    const defaultClient = this.homey.settings.get(this.SETTINGS_KEYS.DEFAULT_CLIENT);
    const configured = this.getClient(defaultClient);
    if (configured?.enodeClientId && configured?.enodeClientSecret) {
      return defaultClient;
    }

    // Otherwise, use the first configured client
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
    if (mapping[vehicleId] === clientId) return;
    mapping[vehicleId] = clientId;

    this.homey.settings.set(this.SETTINGS_KEYS.VEHICLE_CLIENT_MAPPING, mapping);
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
