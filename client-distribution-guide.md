# Client Distribution Implementation Guide

## Overview

This document outlines the implementation of a sequential client distribution strategy for the Xpeng Homey integration. The goal is to fill each Enode client to its capacity (25 vehicles) before moving on to the next client in sequence.

## Current Issue

The logs show that vehicles are not being properly distributed across available clients:
- Primary client: 25 vehicles (at capacity)
- Secondary client: 3 vehicles
- Client 3: 0 vehicles
- Client 4: 0 vehicles

## Implementation Requirements

Add a new method to the `ClientManager` class that implements a "fill-to-capacity" strategy for client selection.

## Code Changes

### 1. Add a new method to `lib/client-manager.js`:

```javascript
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
```

### 2. Update the `getDefaultClient` method in `lib/client-manager.js`:

```javascript
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
```

## Implementation Details

1. **Vehicle Counting**: The implementation counts how many vehicles are currently assigned to each client using the vehicle-client mapping.

2. **Client Sorting**: Clients are sorted in a specific order:
   - Primary client first
   - Secondary client second
   - Additional clients in numerical order (client_3, client_4, etc.)

3. **Selection Logic**: The first client in the sorted list that hasn't reached 25 vehicles is selected.

4. **Fallback Mechanism**: If all clients are at capacity, the last client in the list is used as a fallback.

5. **Logging**: The selection process is logged for debugging purposes.

## Testing

After implementing these changes, verify that:

1. New vehicles are assigned to the primary client until it reaches 25 vehicles
2. Once primary is full, new vehicles are assigned to the secondary client
3. Once secondary is full, new vehicles are assigned to client_3, and so on

## Expected Outcome

With this implementation, vehicles should be distributed sequentially across clients, filling each to its 25-vehicle capacity before moving to the next one.