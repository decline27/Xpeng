'use strict';

module.exports = {
  async getVehicleData({ homey }) {
    try {
      const driver = await homey.drivers.getDriver('cars');
      const devices = await driver.getDevices();
      
      if (devices.length === 0) {
        return { error: 'No Xpeng vehicle found' };
      }

      const device = devices[0]; // Get the first vehicle
      const data = {
        batteryLevel: await device.getCapabilityValue('batteryLevel'),
        range: await device.getCapabilityValue('range'),
        chargingStatus: await device.getCapabilityValue('chargingStatus'),
        pluggedInStatus: await device.getCapabilityValue('pluggedInStatus'),
        location: await device.getCapabilityValue('location'),
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
