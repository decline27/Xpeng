const Homey = require('homey');
const EnodeAPI = require('./enode-api');

/**
 * Utility to help clean up duplicate vehicles
 * This can be run manually to remove duplicate entries
 */
class DuplicateCleanup {
  constructor(api) {
    this.api = api;
    this.logger = console;
  }

  /**
   * Find duplicate vehicles based on VIN
   * @returns {Promise<Object>} Groups of duplicate vehicles
   */
  async findDuplicates() {
    try {
      // Get all vehicles
      const vehicles = await this.api.getVehicles();

      // Group vehicles by VIN
      const vehiclesByVin = {};
      vehicles.forEach(vehicle => {
        const vin = vehicle.information?.vin;
        if (vin) {
          if (!vehiclesByVin[vin]) {
            vehiclesByVin[vin] = [];
          }
          vehiclesByVin[vin].push(vehicle);
        }
      });

      // Filter to only include VINs with multiple vehicles
      const duplicates = {};
      Object.entries(vehiclesByVin).forEach(([vin, vehicles]) => {
        if (vehicles.length > 1) {
          // Sort by lastSeen date (most recent first)
          vehicles.sort((a, b) => {
            const dateA = new Date(a.lastSeen || 0);
            const dateB = new Date(b.lastSeen || 0);
            return dateB - dateA;
          });

          duplicates[vin] = vehicles;
        }
      });

      return duplicates;
    } catch (error) {
      this.logger.error('Error finding duplicates:', error);
      throw error;
    }
  }

  /**
   * Get the best vehicle from a group of duplicates
   * @param {Array} vehicles - Array of duplicate vehicles
   * @returns {Object} The best vehicle to use
   */
  getBestVehicle(vehicles) {
    if (!vehicles || vehicles.length === 0) {
      return null;
    }

    if (vehicles.length === 1) {
      return vehicles[0];
    }

    // Sort by lastSeen date (most recent first)
    const sorted = [...vehicles].sort((a, b) => {
      const dateA = new Date(a.lastSeen || 0);
      const dateB = new Date(b.lastSeen || 0);
      return dateB - dateA;
    });

    // Return the most recently seen vehicle
    return sorted[0];
  }

  /**
   * Log information about duplicate vehicles
   */
  async logDuplicateInfo() {
    try {
      const duplicates = await this.findDuplicates();

      if (Object.keys(duplicates).length === 0) {
        this.logger.log('No duplicate vehicles found');
        return;
      }

      this.logger.log('Found duplicate vehicles:');
      Object.entries(duplicates).forEach(([vin, vehicles]) => {
        this.logger.log(`VIN: ${vin} has ${vehicles.length} duplicates:`);
        vehicles.forEach(vehicle => {
          this.logger.log(`  - ID: ${vehicle.id}, User ID: ${vehicle.userId}, Last Seen: ${vehicle.lastSeen}`);
        });
      });
    } catch (error) {
      this.logger.error('Error logging duplicate info:', error);
    }
  }
}

module.exports = DuplicateCleanup;
