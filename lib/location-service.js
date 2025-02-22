const fetch = require('node-fetch');

class LocationService {
  static async getAddressFromCoordinates(lat, lon) {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`,
        {
          headers: {
            'User-Agent': 'Homey Xpeng Widget'
          }
        }
      );
      
      if (!response.ok) {
        throw new Error('Network response was not ok');
      }
      
      const data = await response.json();
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

  static parseLocationString(locationStr) {
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
}

module.exports = LocationService;