const VehicleStore = require('../lib/vehicle-store');

describe('VehicleStore', () => {
  let vehicleStore;
  let mockDevice;
  
  beforeEach(() => {
    // Create a mock device object
    mockDevice = {
      log: jest.fn(),
      error: jest.fn(),
      getData: jest.fn().mockReturnValue({ id: 'vehicle-123' }),
      getSettings: jest.fn().mockReturnValue({}),
      setSettings: jest.fn().mockResolvedValue(true),
      getStoreValue: jest.fn(),
      setStoreValue: jest.fn().mockResolvedValue(true)
    };
    
    vehicleStore = new VehicleStore(mockDevice);
    
    // Reset all mocks before each test
    jest.clearAllMocks();
  });
  
  test('should store and retrieve static vehicle data', async () => {
    const staticData = {
      information: {
        brand: 'XPENG',
        model: 'P7',
        year: '2023',
        vin: 'XPENG123456789'
      },
      chargeState: {
        batteryCapacity: 80.5
      }
    };
    
    await vehicleStore.storeStaticData(staticData);
    
    // Should persist in the device store
    expect(mockDevice.setStoreValue).toHaveBeenCalledWith('storedVehicleData', expect.any(String));
    
    // Check stored data
    const storedData = vehicleStore.getStaticData();
    expect(storedData).toEqual({
      vehicleBrand: 'XPENG',
      vehicleModel: 'P7',
      vehicleYear: '2023',
      vehicleVin: 'XPENG123456789',
      batteryCapacity: 80.5
    });
  });
  
  test('should load static data from settings', async () => {
    const storedData = {
      vehicleBrand: 'XPENG',
      vehicleModel: 'G9',
      vehicleYear: '2023',
      vehicleVin: 'XPENG987654321',
      batteryCapacity: 100
    };
    
    mockDevice.getSettings.mockReturnValue({
      storedVehicleData: JSON.stringify(storedData)
    });
    
    const result = await vehicleStore.loadStaticData();
    
    expect(result).toBe(true);
    expect(vehicleStore.getStaticData()).toEqual(storedData);
  });
  
  test('should detect when static data needs updating', () => {
    vehicleStore.staticData = {
      vehicleBrand: 'XPENG',
      vehicleModel: 'P7',
      vehicleYear: '2023',
      vehicleVin: 'XPENG123456789',
      batteryCapacity: 80.5
    };
    
    // No changes
    const noChanges = {
      information: {
        brand: 'XPENG',
        model: 'P7',
        year: '2023',
        vin: 'XPENG123456789'
      },
      chargeState: {
        batteryCapacity: 80.5
      }
    };
    
    expect(vehicleStore.needsStaticUpdate(noChanges)).toBe(false);
    
    // With changes
    const withChanges = {
      information: {
        brand: 'XPENG',
        model: 'P7',
        year: '2024', // Changed year
        vin: 'XPENG123456789'
      },
      chargeState: {
        batteryCapacity: 80.5
      }
    };
    
    expect(vehicleStore.needsStaticUpdate(withChanges)).toBe(true);
  });
  
  test('should process dynamic vehicle data correctly', () => {
    const vehicleData = {
      lastSeen: '2023-01-01T12:00:00Z',
      location: {
        latitude: 37.7749,
        longitude: -122.4194
      },
      chargeState: {
        isPluggedIn: true,
        isCharging: true,
        batteryLevel: 75,
        chargeLimit: 90,
        chargeRate: 7 // Enode reports kW
      },
      odometer: {
        distance: 5000
      }
    };
    
    const processed = vehicleStore.processDynamicData(vehicleData);
    
    expect(processed).toEqual({
      batteryLevel: 75,
      range: undefined, // Not in test data
      chargingStatus: 'Charging',
      pluggedInStatus: true,
      location: expect.stringContaining('37.775°N, 122.419°W'),
      lastSeen: expect.stringContaining('2023-01-01 12:00'),
      odometer: 5000,
      chargingLimit: 90,
      powerDeliveryState: 'Charging',
      measure_power: 7000,
      measure_battery: 75,
      ev_charging_state: 'plugged_in_charging'
    });
  });
  
  test('should handle different charging statuses', () => {
    // Not connected
    expect(vehicleStore.getChargingStatus(false, false, 90, 80)).toBe('Not Connected');
    
    // Connected but not charging
    expect(vehicleStore.getChargingStatus(false, true, 90, 80)).toBe('Connected');
    
    // Charging
    expect(vehicleStore.getChargingStatus(true, true, 90, 80)).toBe('Charging');
    
    // Charge complete
    expect(vehicleStore.getChargingStatus(false, true, 80, 80)).toBe('Charge Complete');
    expect(vehicleStore.getChargingStatus(false, true, 80, 85)).toBe('Charge Complete');
  });
  
  test('should format power delivery correctly', () => {
    expect(vehicleStore.formatPowerDelivery({ isPluggedIn: false })).toBe('Unplugged');
    expect(vehicleStore.formatPowerDelivery({ isPluggedIn: true, isCharging: true })).toBe('Charging');
    expect(vehicleStore.formatPowerDelivery({ powerDeliveryState: 'PLUGGED_IN:NO_POWER' })).toBe('No Power');
    expect(vehicleStore.formatPowerDelivery({})).toBeUndefined();
  });
  
  test('should handle cache operations correctly', () => {
    jest.useFakeTimers();
    
    const data = { batteryLevel: 75, range: '300 km' };
    vehicleStore.setCachedData(data);
    
    // Should be able to retrieve the data
    expect(vehicleStore.getCachedData()).toEqual(data);
    
    // Should return null after TTL expires
    jest.advanceTimersByTime(61000); // Default TTL is 60000ms
    expect(vehicleStore.getCachedData()).toBeNull();
    
    // Should clear cache
    vehicleStore.setCachedData(data);
    expect(vehicleStore.getCachedData()).toEqual(data);
    vehicleStore.clearCache();
    expect(vehicleStore.getCachedData()).toBeNull();
    
    jest.useRealTimers();
  });
  
  test('should handle error when loading static data from invalid JSON', async () => {
    // Set up invalid JSON in settings
    mockDevice.getSettings.mockReturnValue({
      storedVehicleData: '{invalid-json}'
    });
    
    const result = await vehicleStore.loadStaticData();
    
    // Should return false on error
    expect(result).toBe(false);
    // Should log error
    expect(mockDevice.error).toHaveBeenCalled();
  });
  
  test('should handle missing data in processDynamicData', () => {
    // Test with minimal data
    const minimalData = {
      lastSeen: '2023-01-01T12:00:00Z'
      // Missing all other fields
    };
    
    const processed = vehicleStore.processDynamicData(minimalData);
    
    // Should handle missing data gracefully. With no chargeState the plug state is unknown,
    // so status values stay undefined and the device keeps its previous values.
    expect(processed.batteryLevel).toBeUndefined();
    expect(processed.chargingStatus).toBeUndefined();
    expect(processed.pluggedInStatus).toBeUndefined();
    expect(processed.lastSeen).toContain('2023-01-01');
  });
  
  test('should handle error when storing static data', async () => {
    // Mock the store write to fail
    mockDevice.setStoreValue.mockRejectedValueOnce(new Error('Failed to save'));
    
    const staticData = {
      information: {
        brand: 'XPENG',
        model: 'P7'
      }
    };
    
    // Should not throw but log error
    await vehicleStore.storeStaticData(staticData);
    expect(mockDevice.error).toHaveBeenCalled();
  });
});