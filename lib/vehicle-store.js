const Homey = require('homey');
const LocationService = require('./location-service');

class VehicleStore {
    constructor(device) {
        this.device = device;
        this.staticData = null;
        this.cachedData = null;
        this.cacheTimestamp = null;
    }

    getStaticData() {
        return this.staticData || {};
    }

    // Store static vehicle information
    async storeStaticData(data) {
        this.staticData = {
            vehicleBrand: data.information?.brand,
            vehicleModel: data.information?.model || this.device.getData().id.toUpperCase(),
            vehicleYear: data.information?.year,
            vehicleVin: data.information?.vin,
            batteryCapacity: data.chargeState?.batteryCapacity
        };

        // Store in device settings for persistence
        await this.device.setSettings({
            storedVehicleData: JSON.stringify(this.staticData)
        });
    }

    // Load static data from settings
    async loadStaticData() {
        try {
            const stored = this.device.getStoreValue('vehicleData');
            if (stored) {
                this.staticData = stored;
                this.cachedData = stored;
                return stored;
            }
            return null;
        } catch (error) {
            this.device.error('Failed to load stored data:', error);
            return null;
        }
    }

    setCachedData(data) {
        this.cachedData = {
            ...data,
            timestamp: Date.now()
        };
        return this.device.setStoreValue('vehicleData', this.cachedData);
    }

    getCachedData() {
        return this.cachedData;
    }

    isCacheValid() {
        if (!this.cachedData || !this.cachedData.timestamp) return false;
        const cacheAge = Date.now() - this.cachedData.timestamp;
        // Cache valid for 1 hour
        return cacheAge < 60 * 60 * 1000;
    }

    // Check if we need to update static data
    needsStaticUpdate(data) {
        if (!this.staticData) return true;
        return (
            data.vehicleModel !== this.staticData.vehicleModel ||
            data.vehicleYear !== this.staticData.vehicleYear ||
            data.vehicleVin !== this.staticData.vehicleVin
        );
    }

    // Process dynamic vehicle data
    async processDynamicData(data) {
        const lastSeenFormatted = this.formatLastSeen(data.lastSeen);
        
        return {
            batteryLevel: data.chargeState?.batteryLevel,
            range: data.chargeState?.range,
            chargingStatus: this.getChargingStatus(
                data.chargeState?.isCharging,
                data.chargeState?.isPluggedIn,
                data.chargeState?.chargeLimit,
                data.chargeState?.batteryLevel
            ),
            pluggedInStatus: data.chargeState?.isPluggedIn,
            location: data.location,
            lastSeen: lastSeenFormatted,
            odometer: data.odometer?.distance ? `${data.odometer.distance} km` : null,
            chargingLimit: data.chargeState?.chargeLimit,
            powerDeliveryState: this.formatPowerDelivery(
                data.chargeState?.chargeRate,
                data.chargeState?.isCharging
            ),
            timestamp: Date.now()
        };
    }

    // Helper function to format location
    formatLocation(location) {
        if (!location?.latitude || !location?.longitude) return 'Not Available';
        
        try {
            const lat = parseFloat(location.latitude).toFixed(6);
            const lng = parseFloat(location.longitude).toFixed(6);
            return `${lat}°N, ${lng}°E`;
        } catch (e) {
            return 'Invalid Location';
        }
    }

    // Helper function to get charging status
    getChargingStatus(isCharging, isPluggedIn, chargeLimit, batteryLevel) {
        if (!isPluggedIn) return 'Not Connected';
        if (isCharging) return 'Charging';
        if (chargeLimit && batteryLevel >= chargeLimit) return 'Charge Complete';
        return 'Connected';
    }

    // Helper function to format power delivery
    formatPowerDelivery(chargeRate, isCharging) {
        if (!isCharging) return 'No Power';
        if (!chargeRate) return 'Unknown';
        
        const power = parseFloat(chargeRate);
        if (isNaN(power)) return 'Unknown';
        
        if (power > 1000) {
            return `${(power / 1000).toFixed(1)} kW`;
        }
        return `${power.toFixed(1)} W`;
    }

    formatLastSeen(lastSeen) {
        if (!lastSeen) return 'Unknown';
        
        try {
            const date = new Date(lastSeen);
            if (isNaN(date.getTime())) {
                return 'Invalid Date';
            }

            // If it's within the last 24 hours, show relative time
            const now = new Date();
            const diffMs = now - date;
            const diffMins = Math.floor(diffMs / (1000 * 60));
            
            if (diffMins < 60) {
                return `${diffMins} minutes ago`;
            } else if (diffMins < 1440) { // 24 hours
                const hours = Math.floor(diffMins / 60);
                return `${hours} hours ago`;
            } else {
                // For older dates, show full date and time
                return date.toLocaleString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });
            }
        } catch (error) {
            this.device.error('Error formatting last seen:', error);
            return 'Unknown';
        }
    }
}

module.exports = VehicleStore;
