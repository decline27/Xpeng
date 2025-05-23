# Performance Optimizations

This document provides a detailed explanation of the performance optimizations implemented in the XPENG Car Manager Homey application.

## Overview

The XPENG Car Manager implements several performance optimizations to improve responsiveness, reduce API calls, and optimize resource usage. These optimizations include caching, rate limiting, adaptive polling, and request batching.

## Key Components

### TokenCache

The `TokenCache` class in `utils.js` implements a cache for access tokens. It stores tokens in memory and refreshes them automatically when they expire.

```javascript
class TokenCache {
  constructor() {
    this.cache = new Map();
  }

  // Set token in cache
  set(key, token, expiresIn) {
    // Calculate expiration time (with 5-minute buffer)
    const expiresAt = Date.now() + (expiresIn - 300) * 1000;
    
    // Store token and expiration time
    this.cache.set(key, {
      token,
      expiresAt
    });
  }

  // Get token from cache
  get(key) {
    const entry = this.cache.get(key);
    
    // Check if token exists and is not expired
    if (entry && Date.now() < entry.expiresAt) {
      return entry.token;
    }
    
    return null;
  }

  // Clear cache
  clear() {
    this.cache.clear();
  }
}
```

### RequestCache

The `RequestCache` class in `utils.js` implements a time-based cache for API responses. It stores responses in memory and returns cached responses for subsequent requests within the cache TTL.

```javascript
class RequestCache {
  constructor(maxSize = 100, defaultTTL = 60000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
  }

  // Set value in cache
  set(key, value, ttl = this.defaultTTL) {
    // Check if cache is full
    if (this.cache.size >= this.maxSize) {
      this.cleanup(true); // Force cleanup if at max size
    }

    // Store value and timestamp
    this.cache.set(key, {
      data: value,
      timestamp: Date.now(),
      ttl
    });
  }

  // Get value from cache
  get(key) {
    const entry = this.cache.get(key);
    
    // Check if entry exists
    if (!entry) return null;

    // Check if entry is expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  // Clean up expired entries
  cleanup(force = false) {
    const now = Date.now();
    
    // If force is true, remove at least 20% of entries
    const minEntriesToRemove = force ? Math.ceil(this.cache.size * 0.2) : 0;
    let removedCount = 0;
    
    // Remove expired entries
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        removedCount++;
      }
      
      // If force is true and we've removed enough entries, stop
      if (force && removedCount >= minEntriesToRemove) {
        break;
      }
    }
    
    // If force is true and we haven't removed enough entries, remove oldest entries
    if (force && removedCount < minEntriesToRemove) {
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      for (let i = 0; i < minEntriesToRemove - removedCount; i++) {
        if (i < entries.length) {
          this.cache.delete(entries[i][0]);
        }
      }
    }
  }

  // Clear cache
  clear() {
    this.cache.clear();
  }
}
```

### RateLimiter

The `RateLimiter` class in `utils.js` implements a token bucket algorithm for rate limiting API calls. It ensures that the application doesn't exceed the API rate limits.

```javascript
class RateLimiter {
  constructor(maxRequests = 10, timeWindow = 1000) {
    this.maxRequests = maxRequests;
    this.timeWindow = timeWindow;
    this.requests = [];
  }

  // Throttle requests
  async throttle() {
    const now = Date.now();
    
    // Remove expired requests
    this.requests = this.requests.filter(time => time > now - this.timeWindow);
    
    // Check if we've reached the maximum number of requests
    if (this.requests.length >= this.maxRequests) {
      // Calculate wait time
      const oldestRequest = this.requests[0];
      const waitTime = oldestRequest - (now - this.timeWindow);
      
      // Wait for the specified time
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    
    // Add current request
    this.requests.push(now);
  }
}
```

### Adaptive Polling

The `XpengCarDevice` class implements adaptive polling to optimize data freshness and API usage. It adjusts the polling interval based on vehicle state.

```javascript
setupAdaptivePolling() {
  // Define polling intervals
  const POLLING_INTERVALS = {
    CHARGING: 60000, // 1 minute
    DRIVING: 120000, // 2 minutes
    IDLE: 300000, // 5 minutes
    OFFLINE: 600000 // 10 minutes
  };
  
  // Get current vehicle state
  const vehicleState = this.getVehicleState();
  
  // Determine polling interval
  let pollingInterval = POLLING_INTERVALS.IDLE;
  
  if (vehicleState === 'charging') {
    pollingInterval = POLLING_INTERVALS.CHARGING;
  } else if (vehicleState === 'driving') {
    pollingInterval = POLLING_INTERVALS.DRIVING;
  } else if (vehicleState === 'offline') {
    pollingInterval = POLLING_INTERVALS.OFFLINE;
  }
  
  // Clear existing polling interval
  if (this.pollingInterval) {
    this.homey.clearInterval(this.pollingInterval);
  }
  
  // Set new polling interval
  this.pollingInterval = this.homey.setInterval(() => {
    this.pollVehicleData();
  }, pollingInterval);
  
  // Log polling interval
  this.log(`Adaptive polling set to ${pollingInterval / 1000} seconds`);
}

getVehicleState() {
  // Get vehicle data
  const vehicleData = this.vehicleStore.getCachedData();
  
  // Check if vehicle is offline
  if (!vehicleData || !vehicleData.isOnline) {
    return 'offline';
  }
  
  // Check if vehicle is charging
  if (vehicleData.chargeState && vehicleData.chargeState.isCharging) {
    return 'charging';
  }
  
  // Check if vehicle is driving
  if (vehicleData.driveState && vehicleData.driveState.speed > 0) {
    return 'driving';
  }
  
  // Default to idle
  return 'idle';
}
```

### Retry with Backoff

The `retryWithBackoff` function in `utils.js` implements an exponential backoff strategy for retrying failed operations. It helps handle transient errors and improves reliability.

```javascript
async function retryWithBackoff(operation, maxRetries = 3, initialDelay = 1000) {
  let retries = 0;
  let delay = initialDelay;
  
  while (true) {
    try {
      return await operation();
    } catch (error) {
      // Check if we've reached the maximum number of retries
      if (retries >= maxRetries) {
        throw error;
      }
      
      // Check if the error is retryable
      if (!isRetryableError(error)) {
        throw error;
      }
      
      // Increment retry count
      retries++;
      
      // Wait for the delay
      await new Promise(resolve => setTimeout(resolve, delay));
      
      // Increase delay for next retry
      delay *= 2;
    }
  }
}

function isRetryableError(error) {
  // Network errors are retryable
  if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
    return true;
  }
  
  // Timeout errors are retryable
  if (error.name === 'AbortError') {
    return true;
  }
  
  // Some HTTP errors are retryable
  if (error.message.includes('HTTP error 429') || error.message.includes('HTTP error 500')) {
    return true;
  }
  
  return false;
}
```

## Caching Strategies

The application implements several caching strategies to optimize performance:

### Token Caching

Access tokens are cached in memory and refreshed automatically when they expire. This reduces the number of token requests and improves performance.

```javascript
async function getMachineToken(credentials, accountId = 'default') {
  const { clientId, clientSecret } = credentials;
  
  // Check if we have a valid cached token
  if (tokenCache[accountId] && Date.now() < tokenCache[accountId].expiresAt) {
    return tokenCache[accountId].token;
  }
  
  // Fetch new token
  const token = await fetchNewToken(clientId, clientSecret);
  
  // Cache token
  tokenCache[accountId] = {
    token,
    expiresAt: Date.now() + (token.expires_in - 300) * 1000
  };
  
  return token;
}
```

### API Response Caching

API responses are cached in memory and returned for subsequent requests within the cache TTL. This reduces the number of API calls and improves performance.

```javascript
async getVehicleData(vehicleId, accountId = null) {
  // Check cache first
  const cacheKey = `vehicle_${vehicleId}`;
  const cachedData = this.requestCache.get(cacheKey);
  
  if (cachedData) {
    return cachedData;
  }
  
  // Fetch data from API
  const data = await this.fetchVehicleData(vehicleId, accountId);
  
  // Cache data
  this.requestCache.set(cacheKey, data);
  
  return data;
}
```

### Static Data Caching

Static vehicle data is cached in device settings to reduce the amount of data that needs to be fetched from the API.

```javascript
async storeStaticData(data) {
  // Extract static data
  const staticData = {
    vin: data.vin,
    model: data.model,
    year: data.year,
    color: data.color,
    licensePlate: data.licensePlate
  };
  
  // Store static data in device settings
  await this.device.setSettings({
    staticData: JSON.stringify(staticData)
  });
}

async loadStaticData() {
  // Load static data from device settings
  const staticDataString = this.device.getSettings().staticData;
  
  if (staticDataString) {
    return JSON.parse(staticDataString);
  }
  
  return null;
}
```

## Conclusion

The performance optimizations in the XPENG Car Manager Homey application help improve responsiveness, reduce API calls, and optimize resource usage. These optimizations include token caching, API response caching, static data caching, rate limiting, adaptive polling, and retry with backoff. Together, these optimizations provide a better user experience and reduce the load on the Enode API.
