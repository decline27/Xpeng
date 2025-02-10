'use strict';

const fetch = require('node-fetch');

function parseLocationString(locationStr) {
  try {
    // Extract coordinates from the parentheses, e.g., "(12.3456, -65.4321)"
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
    const data = await response.json();
    console.log('Nominatim response:', data);
    
    if (data.error) {
      return null;
    }

    // Format the address in a readable way
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
  async getVehicleData({ homey }) {
    try {
      const driver = await homey.drivers.getDriver('cars');
      const devices = await driver.getDevices();
      
      if (devices.length === 0) {
        return { error: 'No Xpeng vehicle found' };
      }

      const device = devices[0];
      // Get cached data from the device
      const data = await device.getCachedVehicleData();
      
      if (!data) {
        return { error: 'No vehicle data available' };
      }

      // Parse location if provided
      let location = null;
      let address = null;
      if (data.location && typeof data.location === 'string') {
        location = parseLocationString(data.location);
        console.log('Parsed location:', location);
        if (location) {
          address = await getAddressFromCoordinates(location.latitude, location.longitude);
          console.log('Retrieved address:', address);
        }
      }

      const finalData = {
        ...data,
        location,
        address
      };

      console.log('Final data being sent to frontend:', JSON.stringify(finalData, null, 2));
      return finalData;
    } catch (error) {
      console.error('Error in getVehicleData:', error);
      return { error: error.message };
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
      // Call the device's startCharging method
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
      // Call the device's stopCharging method (ensure your device supports this)
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
      
      // Use the refresh_interval setting (in minutes)
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
    Homey.on('settings.changed', async (settings) => {
      console.log('Settings changed:', settings);
      if (settings.refresh_interval) {
        console.log('Refresh interval updated:', settings.refresh_interval);
        // Optionally, update your polling interval here.
      }
    });
  }
};

// ==================================================================
// Client-side helper functions for the widget.
// (Ensure these are integrated into your widget's front-end code as needed.)
// ==================================================================

function updateData() {
  // Example client-side function: fetch new data and update UI.
  console.log('updateData: Fetching vehicle data...');
}

function startPolling(refreshInterval) {
  const intervalMs = refreshInterval * 60 * 1000; // convert minutes to ms
  console.log(`Starting polling every ${intervalMs} ms`);
  setInterval(updateData, intervalMs);
}
