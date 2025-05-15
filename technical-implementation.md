# Technical Implementation Guide: Multiple Enode Clients

This document provides detailed technical instructions for implementing support for multiple Enode clients in the Xpeng Car Manager app.

## Code Changes

### 1. Create ClientManager Class

Create a new file `lib/client-manager.js`:

```javascript
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
      // Initially set to primary client for new vehicles
      this.homey.settings.set(this.SETTINGS_KEYS.DEFAULT_CLIENT, 'primary');
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
```

### 2. Update EnodeAPI Class

Modify `lib/enode-api.js` to use the new ClientManager:

```javascript
// Update imports
const ClientManager = require('./client-manager');

// In the constructor
this.clientManager = new ClientManager(api);

// Update getAccessToken method
async getAccessToken(vehicleId = null, clientId = null) {
  try {
    // Determine which client to use
    let credentials;

    if (clientId) {
      // If client ID is explicitly provided, use it
      credentials = this.clientManager.getClientCredentials(clientId);
    } else if (vehicleId) {
      // If vehicle ID is provided, get the client associated with it
      credentials = this.clientManager.getVehicleCredentials(vehicleId);
    } else {
      // Otherwise use the default client
      credentials = this.clientManager.getClientCredentials();
    }

    // Get token using the appropriate credentials
    return await getMachineToken(credentials, credentials.clientIdentifier);
  } catch (error) {
    this.api.error('Error fetching access token:', error);
    throw new Error(`Error fetching access token: ${error.message}`);
  }
}
```

### 3. Update Token Management

Modify `lib/enode-machine-token.js` to support client-specific tokens:

```javascript
// Token cache for multiple clients
// Structure: { clientId: { token, expiresAt } }
let tokenCache = {};

/**
 * Gets a valid machine token for a specific client, fetching a new one if necessary
 * @param {Object} credentials - The credentials object with clientId and clientSecret
 * @param {string} clientIdentifier - The client identifier for caching
 * @returns {Promise<string>} The access token
 */
async function getMachineToken(credentials = null, clientIdentifier = 'default') {
  // Implementation details...
}
```

### 4. Update Driver Class

Modify the pairing process in `drivers/cars/driver.js`:

```javascript
// In onPair method, update the link generation
session.setHandler('get_link', async () => {
  try {
    // Generate a unique installation ID if not already set
    let installationId = this.homey.settings.get('installation_id');
    if (!installationId) {
      installationId = Date.now().toString();
      this.homey.settings.set('installation_id', installationId);
    }

    // Create a unique user ID for this Homey
    const homeyId = this.homey.id || 'homey';
    const userId = `homey-${homeyId}-${installationId}`;

    // Find an available client that hasn't reached capacity
    const clientId = this.clientManager.findAvailableClient();
    
    if (!clientId) {
      throw new Error('All clients have reached their capacity. Please add a new client.');
    }

    // Generate the link URL using the selected client
    const linkUrl = await this.enodeApi.generateVehicleLink(userId, clientId);

    // Store the client ID used for this pairing session
    this.homey.settings.set('last_pairing_client', clientId);

    return { linkUrl };
  } catch (error) {
    this.error('Error generating link:', error);
    throw new Error(`Failed to generate link: ${error.message}`);
  }
});
```

## Configuration

### env.json Setup

The env.json file must contain credentials for both primary and secondary clients:

```json
{
  "ENODE_CLIENT_ID": "primary-client-id",
  "ENODE_CLIENT_SECRET": "primary-client-secret",
  "ENODE_CLIENT_ID_SECONDARY": "secondary-client-id",
  "ENODE_CLIENT_SECRET_SECONDARY": "secondary-client-secret"
}
```

**Important Security Note**: The env.json file is automatically encrypted when the app is published to the Homey App Store. This ensures credentials remain secure and are not exposed to end users.

## Testing

### Test Cases

1. Pairing a new vehicle when primary client has capacity
2. Pairing a new vehicle when primary client is at capacity
3. Re-pairing an existing vehicle
4. Removing and re-adding a vehicle
5. Accessing vehicle data across multiple clients
6. Security test: ensuring users only see their own vehicles

## Deployment

1. Implement changes in the feature branch
2. Test thoroughly with both primary and secondary clients
3. Create a beta release for limited user testing
4. Deploy to production with careful monitoring
