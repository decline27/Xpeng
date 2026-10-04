const Homey = require('homey');

class VehicleStore {
    constructor(device) {
        this.device = device;
        this.staticData = null;
        this.cache = new Map();
        this.CACHE_TTL = 60000; // 1 minute TTL
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
        try {
            await this.device.setSettings({
                storedVehicleData: JSON.stringify(this.staticData)
            });
        } catch (error) {
            this.device.error('Failed to save vehicle data to settings:', error);
        }
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

    /**
     * Process the dynamic part of an Enode vehicle into capability values.
     * Values that are unknown are returned as undefined so the previous capability value is kept.
     * @param {Object} data - Enode vehicle object
     * @returns {Object} capability values keyed by capability id
     */
    processDynamicData(data) {
        const chargeState = data.chargeState || {};
        const isPluggedIn = typeof chargeState.isPluggedIn === 'boolean' ? chargeState.isPluggedIn : undefined;

        this.device.log('Processing charge state:', {
            isPluggedIn: chargeState.isPluggedIn,
            isCharging: chargeState.isCharging,
            batteryLevel: chargeState.batteryLevel,
            chargeLimit: chargeState.chargeLimit,
            powerDeliveryState: chargeState.powerDeliveryState
        });

        return {
            batteryLevel: chargeState.batteryLevel !== undefined ? chargeState.batteryLevel : undefined,
            range: chargeState.range,
            chargingStatus: this.getChargingStatus(
                chargeState.isCharging,
                isPluggedIn,
                chargeState.chargeLimit,
                chargeState.batteryLevel,
                chargeState.powerDeliveryState,
                chargeState.isFullyCharged
            ),
            pluggedInStatus: isPluggedIn,
            location: data.location ? this.formatLocation(data.location) : 'Not Available',
            lastSeen: data.lastSeen ? this.formatLastSeen(data.lastSeen) : 'Not Available',
            odometer: typeof data.odometer?.distance === 'number' ? data.odometer.distance : null,
            chargingLimit: chargeState.chargeLimit,
            powerDeliveryState: this.formatPowerDelivery(chargeState),
            measure_power: this.getChargePowerWatts(chargeState)
        };
    }

    /**
     * Format a timestamp as "YYYY-MM-DD HH:mm" in the Homey's timezone.
     * Falls back to UTC (labelled) when the timezone is unknown.
     * @param {string} timestamp - ISO timestamp
     * @returns {string}
     */
    formatLastSeen(timestamp) {
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return 'Not Available';

        let timeZone = null;
        try {
            timeZone = this.device.homey?.clock?.getTimezone() || null;
        } catch (error) {
            timeZone = null;
        }

        if (timeZone) {
            try {
                return new Intl.DateTimeFormat('sv-SE', {
                    timeZone,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                }).format(date);
            } catch (error) {
                this.device.error('Failed to format lastSeen in timezone', timeZone, error.message);
            }
        }

        return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    }

    /**
     * Format coordinates as a readable label followed by the raw "(lat,lng)" pair, which the
     * location flow cards parse.
     * @param {{latitude:number, longitude:number}} location
     * @returns {string}
     */
    formatLocation(location) {
        const lat = parseFloat(location?.latitude);
        const lng = parseFloat(location?.longitude);
        if (location?.latitude == null || location?.longitude == null || isNaN(lat) || isNaN(lng)) {
            return 'Not Available';
        }

        const latLabel = `${Math.abs(lat).toFixed(3)}°${lat < 0 ? 'S' : 'N'}`;
        const lngLabel = `${Math.abs(lng).toFixed(3)}°${lng < 0 ? 'W' : 'E'}`;
        return `${latLabel}, ${lngLabel} (${location.latitude},${location.longitude})`;
    }

    /**
     * Derive the charging status shown on the device.
     * Returns undefined when the plug state is unknown so the previous status is kept.
     */
    getChargingStatus(isCharging, isPluggedIn, chargeLimit, batteryLevel, powerDeliveryState, isFullyCharged) {
        if (powerDeliveryState === 'UNPLUGGED') return 'Not Connected';
        if (powerDeliveryState === 'PLUGGED_IN:CHARGING') return 'Charging';
        if (powerDeliveryState === 'PLUGGED_IN:COMPLETE') return 'Charge Complete';
        if (powerDeliveryState === 'PLUGGED_IN:FAULT') return 'Error';

        if (isPluggedIn === undefined || isPluggedIn === null) return undefined;
        if (!isPluggedIn) return 'Not Connected';
        if (isCharging) return 'Charging';
        if (isFullyCharged) return 'Charge Complete';
        if (chargeLimit && batteryLevel >= chargeLimit) return 'Charge Complete';
        return 'Connected';
    }

    /**
     * Human-readable label for Enode's chargeState.powerDeliveryState.
     * @param {Object} chargeState
     * @returns {string|undefined}
     */
    formatPowerDelivery(chargeState = {}) {
        const labels = {
            'UNPLUGGED': 'Unplugged',
            'PLUGGED_IN:INITIALIZING': 'Initializing',
            'PLUGGED_IN:CHARGING': 'Charging',
            'PLUGGED_IN:STOPPED': 'Stopped',
            'PLUGGED_IN:COMPLETE': 'Complete',
            'PLUGGED_IN:NO_POWER': 'No Power',
            'PLUGGED_IN:FAULT': 'Fault',
            'PLUGGED_IN:DISCHARGING': 'Discharging'
        };
        if (labels[chargeState.powerDeliveryState]) {
            return labels[chargeState.powerDeliveryState];
        }

        if (chargeState.isPluggedIn === false) return 'Unplugged';
        if (chargeState.isPluggedIn === true) return chargeState.isCharging ? 'Charging' : 'Plugged In';
        return undefined;
    }

    /**
     * Charge power in W. Enode reports chargeRate in kW.
     * @param {Object} chargeState
     * @returns {number|undefined}
     */
    getChargePowerWatts(chargeState = {}) {
        if (chargeState.isCharging === false) return 0;
        if (chargeState.isCharging !== true) return undefined;
        const kw = parseFloat(chargeState.chargeRate);
        return isNaN(kw) ? 0 : Math.round(kw * 1000);
    }

    setCachedData(data) {
        if (!data) return;
        
        const cacheEntry = {
            data,
            timestamp: Date.now()
        };
        
        this.cache.set('vehicleData', cacheEntry);
    }

    getCachedData() {
        const cacheEntry = this.cache.get('vehicleData');
        if (!cacheEntry) return null;

        // Check if cache is still valid
        if (Date.now() - cacheEntry.timestamp > this.CACHE_TTL) {
            this.cache.delete('vehicleData');
            return null;
        }

        return cacheEntry.data;
    }

    clearCache() {
        this.cache.clear();
    }
}

module.exports = VehicleStore;
