const Homey = require('homey');

class VehicleStore {
    constructor(device) {
        this.device = device;
        this.staticData = null;
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
            const settings = this.device.getSettings();
            if (settings.storedVehicleData) {
                this.staticData = JSON.parse(settings.storedVehicleData);
                return true;
            }
        } catch (error) {
            this.device.error('Failed to load stored vehicle data:', error);
        }
        return false;
    }

    // Get static data
    getStaticData() {
        return this.staticData;
    }

    // Check if we need to update static data
    needsStaticUpdate(newData) {
        if (!this.staticData) return true;

        const newStaticData = {
            vehicleBrand: newData.information?.brand,
            vehicleModel: newData.information?.model || this.device.getData().id.toUpperCase(),
            vehicleYear: newData.information?.year,
            vehicleVin: newData.information?.vin,
            batteryCapacity: newData.chargeState?.batteryCapacity
        };

        return Object.entries(newStaticData).some(([key, value]) => 
            this.staticData[key] !== value && value !== undefined
        );
    }

    // Process dynamic vehicle data
    processDynamicData(data) {
        // Format lastSeen
        const lastSeenDate = data.lastSeen ? new Date(data.lastSeen) : null;
        const lastSeenFormatted = lastSeenDate 
            ? `${lastSeenDate.toISOString().slice(0, 16).replace('T', ' ')}` 
            : "Not Available";

        // Format location
        const locationData = data.location 
            ? this.formatLocation(data.location)
            : "Not Available";

        return {
            batteryLevel: data.chargeState?.batteryLevel ? `${data.chargeState.batteryLevel}%` : 'Unknown',
            range: data.chargeState?.range,
            chargingStatus: this.getChargingStatus(
                data.chargeState?.isCharging,
                data.chargeState?.isPluggedIn,
                data.chargeState?.chargeLimit,
                data.chargeState?.batteryLevel
            ),
            pluggedInStatus: data.chargeState?.isPluggedIn,
            location: locationData,
            lastSeen: lastSeenFormatted,
            odometer: data.odometer?.distance ? `${data.odometer.distance} km` : null,
            chargingLimit: data.chargeState?.chargeLimit,
            powerDeliveryState: this.formatPowerDelivery(
                data.chargeState?.powerDeliveryState,
                data.chargeState?.isCharging
            )
        };
    }

    // Helper function to format location
    formatLocation(location) {
        if (!location?.latitude || !location?.longitude) return 'Not Available';
        
        const mapsUrl = `${location.latitude},${location.longitude}`;
        
        try {
            const lat = parseFloat(location.latitude).toFixed(3);
            const lng = parseFloat(location.longitude).toFixed(3);
            return `${lat}°N, ${lng}°E (${mapsUrl})`;
        } catch (e) {
            return mapsUrl;
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
    formatPowerDelivery(powerState, isCharging) {
        if (!isCharging) return 'No Power';
        if (!powerState) return 'Unknown';
        
        const power = powerState > 1000 ? (powerState / 1000).toFixed(1) : powerState;
        const unit = powerState > 1000 ? 'kW' : 'W';
        
        return `${power} ${unit}`;
    }
}

module.exports = VehicleStore;
