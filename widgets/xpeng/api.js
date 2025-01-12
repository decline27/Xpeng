'use strict';

const fetch = require('node-fetch');

async function getAddressFromCoordinates(lat, lon) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'Homey Xpeng Widget'
        }
      }
    );
    const data = await response.json();
    
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
      const location = await device.getCapabilityValue('location');
      let address = null;

      if (location && location.latitude && location.longitude) {
        address = await getAddressFromCoordinates(location.latitude, location.longitude);
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

      return data;
    } catch (error) {
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
  }
};
