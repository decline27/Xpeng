'use strict';

const fetch = require('node-fetch');

function parseLocationString(locationStr) {
  try {
    // Extract coordinates from the parentheses
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

      const device = devices[0]; // Get the first vehicle
      const locationString = await device.getCapabilityValue('location');
      console.log('Raw location data from device:', locationString);

      let location = null;
      let address = null;

      if (typeof locationString === 'string') {
        location = parseLocationString(locationString);
        console.log('Parsed location:', location);

        if (location) {
          address = await getAddressFromCoordinates(location.latitude, location.longitude);
          console.log('Retrieved address:', address);
        }
      }

      const data = {
        batteryLevel: await device.getCapabilityValue('batteryLevel'),
        range: await device.getCapabilityValue('range'),
        chargingStatus: await device.getCapabilityValue('chargingStatus'),
        pluggedInStatus: await device.getCapabilityValue('pluggedInStatus'),
        location,
        address,
        lastSeen: await device.getCapabilityValue('lastSeen'),
        powerDeliveryState: await device.getCapabilityValue('powerDeliveryState'),
        vehicleModel: await device.getCapabilityValue('vehicleModel')
      };

      console.log('Final data being sent to frontend:', JSON.stringify(data, null, 2));
      return data;
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

  async startCharging({ homey, deviceId }) {
    try {
      console.log('Starting charging flow...');
      
      // Trigger the start charging flow
      await homey.flow.triggerFlow({
        id: 'start_charging',
        args: {
          device: deviceId
        }
      });
      
      console.log('Charging flow triggered successfully');
      
      return { success: true };
    } catch (error) {
      console.error('Failed to start charging:', error);
      return { error: error.message };
    }
  },

  async initWidget({ homey }) {
    try {
      const settings = await homey.get('settings');
      console.log('Widget settings:', settings);
      
      // Apply size from settings
      if (settings && settings.size) {
        document.documentElement.style.setProperty('--widget-size', settings.size);
        console.log('Applied widget size:', settings.size);
      }
      
      // Start data updates
      await updateData();
      startPolling();
    } catch (error) {
      console.error('Failed to initialize widget:', error);
      showError('Failed to initialize: ' + error.message);
    }
  },

  async handleSettingsChanged({ homey }) {
    Homey.on('settings.changed', async (settings) => {
      console.log('Settings changed:', settings);
      if (settings.size) {
        document.documentElement.style.setProperty('--widget-size', settings.size);
        console.log('Updated widget size:', settings.size);
      }
    });
  }
};
