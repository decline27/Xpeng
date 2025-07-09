'use strict';

const fetch = require('node-fetch');

// --- Smart polling configuration ---
const MIN_POLL_INTERVAL = 7 * 60 * 1000; // 7 minutes in ms (~9 requests per hour)
let lastPollTimestamp = 0;
let pollInProgress = false;
let lastSuccessfulData = null; // store the last known good data

// --- Caching configuration with differentiated TTLs ---
const CACHE = {
  staticData: null,  // Brand, model, VIN, battery capacity
  dynamicData: null, // Battery level, range, charging status
  locationData: null, // Location and address information
  staticTimestamp: 0,
  dynamicTimestamp: 0,
  locationTimestamp: 0
};

// Different TTLs for different data types
const STATIC_TTL = 24 * 60 * 60 * 1000; // 24 hours for static data
const DYNAMIC_TTL = MIN_POLL_INTERVAL;  // 7 minutes for dynamic data
const LOCATION_TTL = 30 * 60 * 1000;    // 30 minutes for location data

function getCachedData() {
  return {
    ...(CACHE.staticData || {}),
    ...(CACHE.dynamicData || {}),
    ...(CACHE.locationData || {})
  };
}

function cacheData(data) {
  if (!data) return;
  
  // Separate data into static, dynamic, and location categories
  const staticFields = ['vehicleBrand', 'vehicleModel', 'vehicleVin', 'batteryCapacity', 'vehicleYear'];
  const locationFields = ['location', 'address'];
  
  // Extract static data
  const staticData = {};
  staticFields.forEach(field => {
    if (data[field] !== undefined) staticData[field] = data[field];
  });
  
  // Extract location data
  const locationData = {};
  locationFields.forEach(field => {
    if (data[field] !== undefined) locationData[field] = data[field];
  });
  
  // Everything else is dynamic data
  const dynamicData = { ...data };
  [...staticFields, ...locationFields].forEach(field => {
    delete dynamicData[field];
  });
  
  // Update cache with timestamps
  if (Object.keys(staticData).length > 0) {
    CACHE.staticData = { ...CACHE.staticData, ...staticData };
    CACHE.staticTimestamp = Date.now();
  }
  
  if (Object.keys(dynamicData).length > 0) {
    CACHE.dynamicData = { ...CACHE.dynamicData, ...dynamicData };
    CACHE.dynamicTimestamp = Date.now();
  }
  
  if (Object.keys(locationData).length > 0) {
    CACHE.locationData = { ...CACHE.locationData, ...locationData };
    CACHE.locationTimestamp = Date.now();
  }
}

function isStaticCacheValid() {
  return CACHE.staticData && (Date.now() - CACHE.staticTimestamp < STATIC_TTL);
}

function isDynamicCacheValid() {
  return CACHE.dynamicData && (Date.now() - CACHE.dynamicTimestamp < DYNAMIC_TTL);
}

function isLocationCacheValid() {
  return CACHE.locationData && (Date.now() - CACHE.locationTimestamp < LOCATION_TTL);
}

function isCacheValid() {
  // For backward compatibility
  return isDynamicCacheValid();
}

/**
 * parseLocationString
 * Extracts coordinates from a string like "(12.3456, -65.4321)".
 */
function parseLocationString(locationStr) {
  try {
    const match = locationStr.match(/\(([-\d.]+),([-\d.]+)\)/);
    if (match) {
      return {
        latitude: parseFloat(match[1]),
        longitude: parseFloat(match[2])
      };
    }
    return null;
  } catch (error) {
    console.error('Error parsing location string:', error);
    return null;
  }
}

/**
 * Address cache implementation
 */
const ADDRESS_CACHE = {};
const ADDRESS_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * getAddressFromCoordinates
 * Retrieves a human‐readable address from latitude and longitude using OpenStreetMap's Nominatim.
 * Implements caching to reduce API calls for the same coordinates.
 */
async function getAddressFromCoordinates(lat, lon) {
  try {
    // Round coordinates to 5 decimal places for cache key (approx 1.1 meters precision)
    const roundedLat = Math.round(lat * 100000) / 100000;
    const roundedLon = Math.round(lon * 100000) / 100000;
    const cacheKey = `${roundedLat},${roundedLon}`;
    
    // Check if we have a cached address
    if (ADDRESS_CACHE[cacheKey] && 
        (Date.now() - ADDRESS_CACHE[cacheKey].timestamp < ADDRESS_TTL)) {
      console.log('Using cached address for coordinates:', { lat, lon });
      return ADDRESS_CACHE[cacheKey].address;
    }
    
    console.log('Attempting to get address for coordinates:', { lat, lon });
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'Homey Xpeng Widget'
        }
      }
    );
    if (!response.ok) {
      console.error('Network response was not ok:', response.statusText);
      return null;
    }
    const data = await response.json();
    console.log('Nominatim response:', data);
    if (data.error) {
      return null;
    }
    const address = data.address;
    const parts = [];
    if (address.road) parts.push(address.road);
    if (address.house_number) parts.push(address.house_number);
    if (address.postcode) parts.push(address.postcode);
    if (address.city) parts.push(address.city);
    
    const formattedAddress = parts.join(', ');
    
    // Cache the result
    if (parts.length > 0) {
      ADDRESS_CACHE[cacheKey] = {
        address: formattedAddress,
        timestamp: Date.now()
      };
    }
    
    return formattedAddress;
  } catch (error) {
    console.error('Error getting address:', error);
    return null;
  }
}

module.exports = {
  /**
   * getVehicleData
   * This endpoint returns cached vehicle data.
   * It smartly polls the enode API if enough time has passed.
   * If a poll returns empty or errors occur, it falls back to the last successful data.
   */
  async getVehicleData({ homey }) {
    let retries = 3;
    while (retries > 0) {
      try {
        const driver = await homey.drivers.getDriver('cars');
        const devices = await driver.getDevices();

        if (devices.length === 0) {
          return { error: 'No Xpeng vehicle found' };
        }
        const device = devices[0];

        // --- Smart Polling Logic with Caching ---
        if (isDynamicCacheValid() && isStaticCacheValid() && isLocationCacheValid()) {
          console.log('Using fully cached vehicle data.');
        } else {
          // Check which cache types need refreshing
          const needsDynamicRefresh = !isDynamicCacheValid();
          const needsStaticRefresh = !isStaticCacheValid();
          const needsLocationRefresh = !isLocationCacheValid();
          
          console.log('Cache status:', {
            dynamic: isDynamicCacheValid() ? 'valid' : 'needs refresh',
            static: isStaticCacheValid() ? 'valid' : 'needs refresh',
            location: isLocationCacheValid() ? 'valid' : 'needs refresh'
          });
          
          if (needsDynamicRefresh && !pollInProgress && (Date.now() - lastPollTimestamp >= MIN_POLL_INTERVAL)) {
            pollInProgress = true;
            try {
              console.log('Polling enode API for new vehicle data...');
              await device.pollVehicleData();
              const newData = await device.getCachedVehicleData();
              if (newData && Object.keys(newData).length > 0) {
                cacheData(newData);
                lastPollTimestamp = Date.now();
                lastSuccessfulData = newData;
                console.log('Poll completed with new data at', new Date(lastPollTimestamp));
              } else {
                console.error('Poll returned empty data, using previous successful data');
              }
            } catch (pollErr) {
              console.error('Error polling enode API:', pollErr);
              if (pollErr.message && pollErr.message.includes('429')) {
                console.warn('Rate limit reached. Extending next poll delay.');
                lastPollTimestamp = Date.now() + MIN_POLL_INTERVAL;
              }
            } finally {
              pollInProgress = false;
            }
          }
        }

        // Retrieve data from cache
        let data = getCachedData();
        
        if (!data || Object.keys(data).length === 0) {
          console.warn('Cached data is empty; falling back to last successful data.');
          data = lastSuccessfulData || { error: 'No vehicle data available' };
        } else {
          lastSuccessfulData = data;
        }

        if (!data || (data.error && data.error === 'No vehicle data available')) {
          return data;
        }

        // Parse location if provided
        let location = null;
        let addr = null;
        if (data.location && typeof data.location === 'string') {
          location = parseLocationString(data.location);
          console.log('Parsed location:', location);
          if (location) {
            console.log('Initiating getAddressFromCoordinates with lat:', location.latitude, 'lon:', location.longitude);
            addr = await getAddressFromCoordinates(location.latitude, location.longitude);
            console.log('Retrieved address:', addr);
          }
        }

        const finalData = {
          ...data,
          location,
          address: addr
        };

        console.log('Final data being sent to frontend:', JSON.stringify(finalData, null, 2));
        return finalData;
      } catch (error) {
        retries--;
        console.error(`Error in getVehicleData (${retries} retries left):`, error);
        
        if (retries === 0 || (error.message && error.message.includes('429'))) {
          // Don't retry rate limit errors or if we're out of retries
          return lastSuccessfulData || { error: error.message };
        }
        
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  },

  async updateVehicleData({ homey }) {
    try {
      const driver = await homey.drivers.getDriver('cars');
      const devices = await driver.getDevices();
      if (devices.length === 0) {
        return { error: 'No Xpeng vehicle found' };
      }
      const device = devices[0];
      await device.pollVehicleData();
      lastPollTimestamp = Date.now();
      const newData = await device.getCachedVehicleData();
      if (newData && Object.keys(newData).length > 0) {
        cacheData(newData);
        lastSuccessfulData = newData;
      }
      return { success: true };
    } catch (error) {
      return { error: error.message };
    }
  },

  async startCharging({ homey }) {
    try {
      console.log('Starting charging...');
      const driver = await homey.drivers.getDriver('cars');
      const devices = await driver.getDevices();
      if (devices.length === 0) {
        return { error: 'No Xpeng vehicle found' };
      }
      const device = devices[0];
      await device.startCharging();
      console.log('Charging started successfully');
      return { success: true };
    } catch (error) {
      console.error('Failed to start charging:', error);
      return { error: error.message };
    }
  },

  async stopCharging({ homey }) {
    try {
      console.log('Stopping charging...');
      const driver = await homey.drivers.getDriver('cars');
      const devices = await driver.getDevices();
      if (devices.length === 0) {
        return { error: 'No Xpeng vehicle found' };
      }
      const device = devices[0];
      await device.stopCharging();
      console.log('Charging stopped successfully');
      return { success: true };
    } catch (error) {
      console.error('Failed to stop charging:', error);
      return { error: error.message };
    }
  },

  // Constants for prefetching
  PREFETCH_THRESHOLD: 0.7, // Start prefetching when 70% of TTL has elapsed
  prefetchInProgress: false,
  prefetchTimer: null,
  
  /**
   * Intelligently prefetch data in the background when cache is about to expire
   * This reduces perceived loading time for users
   */
  async prefetchVehicleData(homey) {
    // Don't prefetch if already in progress or if polling is in progress
    if (this.prefetchInProgress || pollInProgress) return;
    
    // Calculate time elapsed since last dynamic data update
    const dynamicElapsed = Date.now() - CACHE.dynamicTimestamp;
    const dynamicThreshold = DYNAMIC_TTL * this.PREFETCH_THRESHOLD;
    
    // Only prefetch if we're approaching cache expiration
    if (dynamicElapsed >= dynamicThreshold) {
      this.prefetchInProgress = true;
      console.log('Starting background prefetch of vehicle data...');
      
      try {
        const driver = await homey.drivers.getDriver('cars');
        const devices = await driver.getDevices();
        
        if (devices.length === 0) {
          this.prefetchInProgress = false;
          return;
        }
        
        const device = devices[0];
        
        // Quietly poll for new data
        await device.pollVehicleData();
        const newData = await device.getCachedVehicleData();
        
        if (newData && Object.keys(newData).length > 0) {
          cacheData(newData);
          lastPollTimestamp = Date.now();
          lastSuccessfulData = newData;
          console.log('Background prefetch completed successfully at', new Date(lastPollTimestamp));
        }
      } catch (error) {
        console.error('Error during background prefetch:', error);
      } finally {
        this.prefetchInProgress = false;
      }
    }
  },
  
  /**
   * Schedule the next prefetch based on cache expiration
   */
  schedulePrefetch(homey) {
    // Clear any existing prefetch timer
    if (this.prefetchTimer) {
      clearTimeout(this.prefetchTimer);
    }
    
    // Calculate time until prefetch should occur (70% of TTL)
    const timeUntilPrefetch = Math.max(
      (DYNAMIC_TTL * this.PREFETCH_THRESHOLD) - (Date.now() - CACHE.dynamicTimestamp),
      0
    );
    
    console.log(`Scheduling next prefetch in ${Math.round(timeUntilPrefetch / 1000)} seconds`);
    
    // Set timer for prefetch
    this.prefetchTimer = setTimeout(() => {
      this.prefetchVehicleData(homey);
      // Reschedule after completion
      this.schedulePrefetch(homey);
    }, timeUntilPrefetch);
  },

  /**
   * initWidget
   * Initialize the widget with settings and start polling
   */
  async initWidget({ homey }) {
    try {
      const settings = await homey.get('settings');
      console.log('Widget initialized with settings:', settings);
      
      // Get initial data
      await updateVehicleData({ homey });
      
      // Start prefetching mechanism
      this.schedulePrefetch(homey);
      
      // Return success
      return { success: true };
    } catch (error) {
      console.error('Error initializing widget:', error);
      return { error: error.message };
    }
  },

  async handleSettingsChanged({ homey }) {
    homey.settings.on('changed', async (settings) => {
      console.log('Settings changed:', settings);
      if (settings.refresh_interval) {
        console.log('Refresh interval updated:', settings.refresh_interval);
      }
    });
  }
};

// ==================================================================
// Client-side helper functions for the widget.
// ==================================================================
async function updateData() {
  console.log('updateData: Fetching vehicle data...');
  try {
    const response = await fetch('/apps/xpeng/api/getVehicleData');
    if (!response.ok) {
      console.error('updateData: Network response error:', response.statusText);
      return;
    }
    const data = await response.json();
    console.log('Vehicle data fetched:', data);
  } catch (error) {
    console.error('Error fetching vehicle data:', error);
  }
}

function startPolling(refreshInterval) {
  const intervalMs = refreshInterval * 60 * 1000;
  console.log(`Starting polling every ${intervalMs} ms`);
  setInterval(updateData, intervalMs);
}
