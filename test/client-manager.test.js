const ClientManager = require('../lib/client-manager');

// Mock Homey
const mockHomey = {
  settings: {
    get: jest.fn(),
    set: jest.fn()
  },
  log: jest.fn()
};

// Mock env
jest.mock('homey', () => ({
  env: {
    ENODE_CLIENT_ID: 'test-primary-client-id',
    ENODE_CLIENT_SECRET: 'test-primary-client-secret',
    ENODE_CLIENT_ID_SECONDARY: 'test-secondary-client-id',
    ENODE_CLIENT_SECRET_SECONDARY: 'test-secondary-client-secret'
  }
}));

describe('ClientManager', () => {
  let clientManager;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock settings
    mockHomey.settings.get.mockImplementation((key) => {
      if (key === 'enode_clients') {
        return {
          'primary': {
            clientId: 'test-primary-client-id',
            clientSecret: 'test-primary-client-secret',
            name: 'Primary Client',
            isDefault: true
          },
          'secondary': {
            clientId: 'test-secondary-client-id',
            clientSecret: 'test-secondary-client-secret',
            name: 'Secondary Client',
            isDefault: false
          }
        };
      }
      if (key === 'vehicle_client_mapping') {
        return {
          'test-vin-1': 'primary',
          'test-vin-2': 'secondary'
        };
      }
      if (key === 'default_client') {
        return 'primary';
      }
      return null;
    });
    
    // Create client manager
    clientManager = new ClientManager(mockHomey);
  });

  test('should initialize with default clients', () => {
    // Mock empty settings
    mockHomey.settings.get.mockReturnValue(null);
    
    // Create new client manager
    const newClientManager = new ClientManager(mockHomey);
    
    // Check that settings were initialized
    expect(mockHomey.settings.set).toHaveBeenCalledWith('enode_clients', expect.any(Object));
    expect(mockHomey.settings.set).toHaveBeenCalledWith('vehicle_client_mapping', {});
    expect(mockHomey.settings.set).toHaveBeenCalledWith('default_client', 'primary');
  });

  test('should get client credentials', () => {
    const credentials = clientManager.getClientCredentials('primary');
    
    expect(credentials).toEqual({
      clientId: 'test-primary-client-id',
      clientSecret: 'test-primary-client-secret',
      name: 'Primary Client',
      clientIdentifier: 'primary'
    });
  });

  test('should get default client credentials when no client specified', () => {
    const credentials = clientManager.getClientCredentials();
    
    expect(credentials).toEqual({
      clientId: 'test-primary-client-id',
      clientSecret: 'test-primary-client-secret',
      name: 'Primary Client',
      clientIdentifier: 'primary'
    });
  });

  test('should throw error for unknown client', () => {
    expect(() => {
      clientManager.getClientCredentials('unknown');
    }).toThrow('Unknown client ID: unknown');
  });

  test('should get default client', () => {
    const defaultClient = clientManager.getDefaultClient();
    
    expect(defaultClient).toBe('primary');
  });

  test('should set vehicle client', () => {
    clientManager.setVehicleClient('test-vin-3', 'secondary');
    
    expect(mockHomey.settings.set).toHaveBeenCalledWith('vehicle_client_mapping', {
      'test-vin-1': 'primary',
      'test-vin-2': 'secondary',
      'test-vin-3': 'secondary'
    });
  });

  test('should get vehicle client', () => {
    const clientId = clientManager.getVehicleClient('test-vin-1');
    
    expect(clientId).toBe('primary');
  });

  test('should return default client for unknown vehicle', () => {
    const clientId = clientManager.getVehicleClient('unknown-vin');
    
    expect(clientId).toBe('primary');
  });

  test('should get vehicle credentials', () => {
    const credentials = clientManager.getVehicleCredentials('test-vin-2');
    
    expect(credentials).toEqual({
      clientId: 'test-secondary-client-id',
      clientSecret: 'test-secondary-client-secret',
      name: 'Secondary Client',
      clientIdentifier: 'secondary'
    });
  });

  test('should find available client', () => {
    // Mock client counts
    clientManager.getClientVehicleCounts = jest.fn().mockReturnValue({
      'primary': 25, // At capacity
      'secondary': 10 // Available
    });
    
    const availableClient = clientManager.findAvailableClient();
    
    expect(availableClient).toBe('secondary');
  });

  test('should return null when all clients are at capacity', () => {
    // Mock client counts
    clientManager.getClientVehicleCounts = jest.fn().mockReturnValue({
      'primary': 25,
      'secondary': 25
    });
    
    const availableClient = clientManager.findAvailableClient();
    
    expect(availableClient).toBeNull();
  });

  test('should migrate from account manager', () => {
    // Mock old mapping
    mockHomey.settings.get.mockImplementation((key) => {
      if (key === 'vehicle_account_mapping') {
        return {
          'test-vin-3': 'primary',
          'test-vin-4': 'secondary'
        };
      }
      if (key === 'vehicle_client_mapping') {
        return {
          'test-vin-1': 'primary',
          'test-vin-2': 'secondary'
        };
      }
      return null;
    });
    
    // Create new client manager
    const newClientManager = new ClientManager(mockHomey);
    
    // Check that migration was performed
    expect(mockHomey.settings.set).toHaveBeenCalledWith('vehicle_client_mapping', {
      'test-vin-1': 'primary',
      'test-vin-2': 'secondary',
      'test-vin-3': 'primary',
      'test-vin-4': 'secondary'
    });
  });
});
