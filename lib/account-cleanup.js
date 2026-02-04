const Homey = require('homey');
const EnodeAPI = require('./enode-api');

/**
 * AccountCleanup utility for identifying and removing inactive Enode car connections.
 * This is designed to be used by admin scripts to free up space in Enode accounts.
 */
class AccountCleanup {
    constructor(api) {
        this.api = api;
        this.logger = console;
    }

    /**
     * Get a comprehensive report of all Enode connections vs active Homey devices
     * @returns {Promise<Object>} Cleanup report
     */
    async generateCleanupReport() {
        try {
            this.logger.log('Generating Enode cleanup report...');

            // 1. Get all Enode vehicles across all clients
            const vehicles = await this.api.getVehicles(null, true, true);
            this.logger.log(`Found ${vehicles.length} total vehicles in Enode accounts (security filter bypassed)`);

            // 2. Get all currently installed Homey devices
            const installedVehicles = await this._getInstalledHomeyVehicles();
            this.logger.log(`Found ${installedVehicles.length} vehicles currently installed in Homey`);

            const installedVinSet = new Set(installedVehicles.map(v => v.vin));
            const installedIdSet = new Set(installedVehicles.map(v => v.vehicleId));

            const report = {
                totalEnodeVehicles: vehicles.length,
                activeHomeyDevices: installedVehicles.length,
                orphanedConnections: [],
                inactiveConnections: [],
                activeConnections: [],
                byClient: {}
            };

            // Pre-populate byClient with all registered clients from ClientManager
            if (this.api.clientManager) {
                const allClients = this.api.clientManager.getAllClients();
                allClients.forEach(client => {
                    report.byClient[client.id] = {
                        total: 0,
                        active: 0,
                        orphaned: 0,
                        inactive: 0
                    };
                });
            }

            const now = Date.now();
            const inactiveThresholdMs = 30 * 24 * 60 * 60 * 1000; // 30 days

            for (const vehicle of vehicles) {
                const clientId = vehicle._clientId || 'unknown';
                if (!report.byClient[clientId]) {
                    report.byClient[clientId] = {
                        total: 0,
                        active: 0,
                        orphaned: 0,
                        inactive: 0
                    };
                }
                report.byClient[clientId].total++;

                const isInstalled = installedVinSet.has(vehicle.information?.vin) ||
                    installedIdSet.has(vehicle.id);

                const lastSeenDate = vehicle.lastSeen ? new Date(vehicle.lastSeen) : new Date(0);
                const daysSinceSeen = Math.floor((now - lastSeenDate.getTime()) / (24 * 60 * 60 * 1000));
                const isInactive = daysSinceSeen > 30;

                const connectionInfo = {
                    id: vehicle.id,
                    vin: vehicle.information?.vin,
                    brand: vehicle.information?.brand,
                    model: vehicle.information?.model,
                    userId: vehicle.userId,
                    clientId: clientId,
                    lastSeen: vehicle.lastSeen,
                    daysSinceSeen: daysSinceSeen,
                    isInstalled: isInstalled
                };

                if (isInstalled) {
                    report.activeConnections.push(connectionInfo);
                    report.byClient[clientId].active++;
                } else if (isInactive) {
                    report.inactiveConnections.push(connectionInfo);
                    report.byClient[clientId].inactive++;
                } else {
                    report.orphanedConnections.push(connectionInfo);
                    report.byClient[clientId].orphaned++;
                }
            }

            return report;
        } catch (error) {
            this.logger.error('Error generating cleanup report:', error);
            throw error;
        }
    }

    /**
     * Get all installed vehicles in Homey
     * @returns {Promise<Array>} List of installed vehicle data
     * @private
     */
    async _getInstalledHomeyVehicles() {
        try {
            // Note: This requires access to the Homey instance or drivers
            // In a standalone script context, we might need to mock this or fetch it differently
            if (this.api.drivers) {
                const driver = this.api.drivers.getDriver('cars');
                if (driver) {
                    const devices = await driver.getDevices();
                    return devices.map(device => {
                        const data = device.getData();
                        return {
                            vehicleId: data.vehicleId || data.id,
                            vin: data.vin
                        };
                    });
                }
            }
            return [];
        } catch (error) {
            this.logger.error('Error getting installed vehicles:', error);
            return [];
        }
    }

    /**
     * Disconnect multiple users
     * @param {Array<Object>} connections - List of connections to disconnect
     * @returns {Promise<Object>} Results of disconnection
     */
    async bulkDisconnect(connections) {
        const results = {
            successful: [],
            failed: []
        };

        for (const connection of connections) {
            try {
                this.logger.log(`Disconnecting user ${connection.userId} (Vehicle: ${connection.id})...`);
                await this.api.disconnectUser(connection.userId, connection.clientId);
                results.successful.push(connection.userId);
            } catch (error) {
                this.logger.error(`Failed to disconnect user ${connection.userId}:`, error.message);
                results.failed.push({ userId: connection.userId, error: error.message });
            }
        }

        return results;
    }
}

module.exports = AccountCleanup;
