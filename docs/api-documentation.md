# Enode API Documentation

This document provides detailed information about the Enode API integration in the XPENG Car Manager Homey application.

## Table of Contents

1. [API Overview](#api-overview)
2. [Authentication](#authentication)
3. [Vehicle Management](#vehicle-management)
4. [Charging Control](#charging-control)
5. [Error Handling](#error-handling)
6. [Rate Limiting and Caching](#rate-limiting-and-caching)
7. [Multi-Client Architecture](#multi-client-architecture)

## API Overview

The XPENG Car Manager integrates with the Enode API to provide control and monitoring of XPENG electric vehicles. The API integration is implemented in the `EnodeAPI` class, with authentication handled by the `EnodeOAuth2` and `enode-machine-token` modules.

### API Endpoints

The application uses the following Enode API endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/oauth2/token` | POST | Get access token using client credentials |
| `/users/{userId}/link` | POST | Generate a vehicle link URL for user authentication |
| `/vehicles` | GET | Get a list of all vehicles |
| `/vehicles/{vehicleId}` | GET | Get data for a specific vehicle |
| `/vehicles/{vehicleId}/refresh-hint` | POST | Request a refresh of vehicle data |
| `/vehicles/{vehicleId}/charging` | POST | Control vehicle charging |
| `/vehicles/actions/{actionId}` | GET | Check the status of a vehicle action |

## Authentication

The application uses OAuth 2.0 for authentication with the Enode API. Two authentication flows are implemented:

1. **Client Credentials Flow**: Used for management API calls
2. **Authorization Code Flow**: Used for user authentication during pairing

### Client Credentials Flow

The client credentials flow is implemented in the `enode-machine-token.js` module. It is used to obtain access tokens for API calls that don't require user authentication.

```javascript
async function getMachineToken(credentials, accountId = 'default') {
  const { clientId, clientSecret } = credentials;
  
  // Check if we have a valid cached token
  if (!tokenCache[accountId] || Date.now() >= tokenCache[accountId].expiresAt) {
    return fetchNewToken(clientId, clientSecret, accountId);
  }
  
  return tokenCache[accountId].token;
}
```

### Authorization Code Flow

The authorization code flow is implemented in the `EnodeOAuth2` class. It is used during the pairing process to authenticate users and link their vehicles.

```javascript
async generateAuthUrl(userId) {
  // Get a machine token for API access
  const machineToken = await this.getMachineToken();
  
  // Generate a link URL
  const response = await fetch(`${this.apiBaseUrl}/users/${userId}/link`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${machineToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      vendorType: 'vehicle',
      scopes: this.scopes,
      language: 'en-US',
      redirectUri: this.redirectUri,
    }),
  });
  
  const data = await response.json();
  return data.linkUrl;
}
```

## Vehicle Management

The application provides several methods for vehicle management through the `EnodeAPI` class.

### Getting Vehicles

The `getVehicles` method retrieves a list of all vehicles from the Enode API. It supports retrieving vehicles from multiple clients and filtering them based on security rules.

```javascript
async getVehicles(clientId = null, getAllClients = true) {
  // If getAllClients is true, fetch vehicles from all clients and merge them
  if (getAllClients) {
    let allVehicles = [];
    
    // Get vehicles from each client
    const clients = this.clientManager.getAllClients();
    for (const client of clients) {
      const clientVehicles = await this._getVehiclesForClient(client.id);
      allVehicles = [...allVehicles, ...clientVehicles];
    }
    
    // Apply filtering logic
    return await this._filterVehicles(allVehicles);
  } else {
    // Get vehicles from a specific client
    return await this._getVehiclesForClient(clientId);
  }
}
```

### Getting Vehicle Data

The `getVehicleData` method retrieves data for a specific vehicle from the Enode API.

```javascript
async getVehicleData(vehicleId, accountId = null) {
  // Check cache first
  const cacheKey = `vehicle_${vehicleId}`;
  const cachedData = this.requestCache.get(cacheKey);
  if (cachedData) {
    return cachedData;
  }
  
  // Get token for the appropriate account
  const accessToken = await this.getAccessToken(vehicleId, accountId);
  
  // Make API request
  const response = await this.makeRequest(
    `${this.apiBaseUrl}/vehicles/${vehicleId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
    }
  );
  
  const data = await response.json();
  
  // Cache the response
  this.requestCache.set(cacheKey, data);
  return data;
}
```

## Charging Control

The application provides methods for controlling vehicle charging through the `EnodeAPI` class.

### Starting Charging

The `startCharging` method starts charging a vehicle.

```javascript
async startCharging(vehicleId) {
  return this.controlCharging(vehicleId, 'START');
}
```

### Stopping Charging

The `stopCharging` method stops charging a vehicle.

```javascript
async stopCharging(vehicleId) {
  return this.controlCharging(vehicleId, 'STOP');
}
```

### Common Charging Control

Both charging methods use the common `controlCharging` method, which handles validation and API calls.

```javascript
async controlCharging(vehicleId, action) {
  // Validate vehicle state
  const vehicleData = await this.getVehicleData(vehicleId);
  
  if (!vehicleData.chargeState?.isPluggedIn) {
    throw new Error('Vehicle is not plugged in');
  }
  
  // Get token for the appropriate account
  const accessToken = await this.getAccessToken(vehicleId);
  
  // Make API request
  const response = await this.makeRequest(
    `${this.apiBaseUrl}/vehicles/${vehicleId}/charging`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({ action })
    }
  );
  
  const data = await response.json();
  
  // Wait for the action to complete
  const finalStatus = await this.waitForAction(data.id);
  return finalStatus;
}
```

## Error Handling

The application uses a centralized `ErrorHandler` class for handling errors. The `EnodeAPI` class includes error handling for all API calls.

```javascript
try {
  // API call
} catch (error) {
  this.api.error(`Failed to ${action.toLowerCase()} charging for vehicle ${vehicleId}:`, error.message);
  throw new Error(`Failed to ${action.toLowerCase()} charging: ${error.message}`);
}
```

## Rate Limiting and Caching

The application implements rate limiting and caching to optimize API usage and improve performance.

### Rate Limiting

The `RateLimiter` class in `utils.js` implements a token bucket algorithm for rate limiting API calls.

```javascript
async throttle() {
  const now = Date.now();
  this.requests = this.requests.filter(time => time > now - this.timeWindow);
  
  if (this.requests.length >= this.maxRequests) {
    const oldestRequest = this.requests[0];
    const waitTime = oldestRequest - (now - this.timeWindow);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  
  this.requests.push(now);
}
```

### Caching

The `RequestCache` class in `utils.js` implements a time-based cache for API responses.

```javascript
set(key, value, ttl = this.defaultTTL) {
  if (this.cache.size >= this.maxSize) {
    this.cleanup(true); // Force cleanup if at max size
  }

  this.cache.set(key, {
    data: value,
    timestamp: Date.now(),
    ttl
  });
}

get(key) {
  const entry = this.cache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.timestamp > entry.ttl) {
    this.cache.delete(key);
    return null;
  }

  return entry.data;
}
```

## Multi-Client Architecture

The application supports multiple Enode clients through the `ClientManager` class. This allows the app to support unlimited clients for scaling beyond the 25-vehicle limit per client.

```javascript
getClientForNewVehicle() {
  // Get all clients
  const clients = this.getAllClients();
  
  // Count vehicles per client
  const vehicleCounts = {};
  clients.forEach(client => {
    vehicleCounts[client.id] = 0;
  });
  
  // Count existing vehicles
  const mapping = this.homey.settings.get(this.SETTINGS_KEYS.VEHICLE_CLIENT_MAPPING) || {};
  Object.values(mapping).forEach(clientId => {
    if (vehicleCounts[clientId] !== undefined) {
      vehicleCounts[clientId]++;
    }
  });
  
  // Find the first client that isn't full (less than 25 vehicles)
  const MAX_VEHICLES_PER_CLIENT = 25;
  
  for (const client of clients) {
    const count = vehicleCounts[client.id] || 0;
    if (count < MAX_VEHICLES_PER_CLIENT) {
      return client.id;
    }
  }
  
  // If all clients are full, use the last one as fallback
  return clients[clients.length - 1].id;
}
```
