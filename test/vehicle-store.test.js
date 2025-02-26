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
      setSettings: jest.fn().mockResolvedValue(true)
    };
    
    vehicleStore = new VehicleStore(mockDevice);
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
    
    // Should call setSettings on the device
    expect(mockDevice.setSettings).toHaveBeenCalledWith({
      storedVehicleData: expect.any(String)
    });
    
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
        chargeRate: 7000 // 7kW
      },
      odometer: {
        distance: 5000
      }
    };
    
    const processed = vehicleStore.processDynamicData(vehicleData);
    
    expect(processed).toEqual({
      batteryLevel: '75%',
      range: undefined, // Not in test data
      chargingStatus: 'Charging',
      pluggedInStatus: true,
      location: expect.stringContaining('37.775°N, -122.419°E'),
      lastSeen: expect.stringContaining('2023-01-01 12:00'),
      odometer: '5000 km',
      chargingLimit: 90,
      powerDeliveryState: '7.0 kW'
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
    // No power
    expect(vehicleStore.formatPowerDelivery(0, false)).toBe('No Power');
    
    // Unknown power
    expect(vehicleStore.formatPowerDelivery(null, true)).toBe('Unknown');
    
    // Power in watts
    expect(vehicleStore.formatPowerDelivery(800, true)).toBe('800.0 W');
    
    // Power in kilowatts
    expect(vehicleStore.formatPowerDelivery(7500, true)).toBe('7.5 kW');
  });
  
  test('should handle cache operations correctly', () => {
    jest.useFakeTimers();
    
    const data = { batteryLevel: '75%', range: '300 km' };
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
});