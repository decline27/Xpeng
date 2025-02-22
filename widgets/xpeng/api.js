'use strict';

const fetch = require('node-fetch');

// --- Smart polling configuration ---
const MIN_POLL_INTERVAL = 7 * 60 * 1000; // 7 minutes in ms (~9 requests per hour)
let lastPollTimestamp = 0;
let pollInProgress = false;
let lastSuccessfulData = null; // store the last known good data

// --- Caching configuration ---
const CACHE = {
  data: null,
  timestamp: 0
};

function getCachedData() {
  return CACHE.data;
}

function cacheData(data) {
  CACHE.data = data;
  CACHE.timestamp = Date.now();
}

function isCacheValid() {
  return CACHE.data && (Date.now() - CACHE.timestamp < MIN_POLL_INTERVAL);
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
 * getAddressFromCoordinates
 * Retrieves a human‐readable address from latitude and longitude using OpenStreetMap’s Nominatim.
 */
async function getAddressFromCoordinates(lat, lon) {
  try {
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
    return parts.join(', ');
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
    try {
      const driver = await homey.drivers.getDriver('cars');
      const devices = await driver.getDevices();

      if (devices.length === 0) {
        return { error: 'No Xpeng vehicle found' };
      }
      const device = devices[0];

      // --- Smart Polling Logic with Caching ---
      if (isCacheValid()) {
        console.log('Using cached vehicle data.');
      } else if (!pollInProgress && (Date.now() - lastPollTimestamp >= MIN_POLL_INTERVAL)) {
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

      // Retrieve data from cache if valid, otherwise get new data.
      let data = isCacheValid() ? getCachedData() : await device.getCachedVehicleData();
      if (!data || Object.keys(data).length === 0) {
        console.warn('Cached data is empty; falling back to last successful data.');
        data = lastSuccessfulData || { error: 'No vehicle data available' };
      } else {
        lastSuccessfulData = data;
        if (!isCacheValid()) {
          cacheData(data);
        }
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
      console.error('Error in getVehicleData:', error);
      return lastSuccessfulData || { error: error.message };
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

  async initWidget({ homey }) {
    try {
      const settings = await homey.get('settings');
      console.log('Widget settings:', settings);
      const refreshInterval = settings.refresh_interval || 5;
      updateData();
      startPolling(refreshInterval);
    } catch (error) {
      console.error('Failed to initialize widget:', error);
      if (typeof showError === 'function') {
        showError('Failed to initialize: ' + error.message);
      }
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
// (Integrate these as needed in your widget's front‑end.)
// ==================================================================

async function updateData() {
  console.log('updateData: Fetching vehicle data...');
  try {
    // Ensure the URL is correct. Update '/apps/xpeng/api/getVehicleData' if needed.
    const response = await fetch('/apps/xpeng/api/getVehicleData'); 
    if (!response.ok) {
      console.error('updateData: Network response error:', response.statusText);
      return;
    }
    const data = await response.json();
    console.log('Vehicle data fetched:', data);
    // TODO: Update widget UI with fetched data.
  } catch (error) {
    console.error('Error fetching vehicle data:', error);
  }
}

function startPolling(refreshInterval) {
  const intervalMs = refreshInterval * 60 * 1000; // convert minutes to ms
  console.log(`Starting polling every ${intervalMs} ms`);
  setInterval(updateData, intervalMs);
}
