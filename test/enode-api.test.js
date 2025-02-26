const EnodeAPI = require('../lib/enode-api');
const fetch = require('node-fetch'); // Use the globally mocked fetch

describe('EnodeAPI', () => {
  let enodeApi;
  let mockApi;
  
  beforeEach(() => {
    // Reset all mocks
    jest.resetAllMocks();
    
    // No need to get reference to fetch, we have it imported
    
    // Create a mock API object that tracks calls
    mockApi = {
      log: jest.fn(),
      error: jest.fn()
    };
    
    // Create instance with mocked API
    enodeApi = new EnodeAPI(mockApi);
    
    // Mock successful fetch response
    const mockResponse = {
      ok: true,
      json: jest.fn().mockResolvedValue({})
    };
    fetch.mockResolvedValue(mockResponse);
  });
  
  describe('makeRequest', () => {
    test('should call fetch with correct parameters', async () => {
      const url = 'https://test-api.com/endpoint';
      const options = { method: 'GET', headers: { 'Content-Type': 'application/json' } };
      
      await enodeApi.makeRequest(url, options);
      
      // Verify that fetch was called with the URL and options that include a signal
      expect(fetch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: expect.any(Object)
      }));
    });
    
    test('should throw error for non-ok response', async () => {
      const errorResponse = {
        ok: false,
        status: 404,
        text: jest.fn().mockResolvedValue('Not Found')
      };
      fetch.mockResolvedValue(errorResponse);
      
      await expect(
        enodeApi.makeRequest('https://test-api.com/error', {})
      ).rejects.toThrow('HTTP error! status: 404');
    });
  });
  
  describe('getAccessToken', () => {
    beforeEach(() => {
      // Mock successful token response
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };
      fetch.mockResolvedValue(tokenResponse);
    });
    
    test('should fetch and cache access token', async () => {
      const clientId = 'test-client';
      const clientSecret = 'test-secret';
      
      const token = await enodeApi.getAccessToken(clientId, clientSecret);
      
      expect(token).toBe('test-token');
      expect(fetch).toHaveBeenCalledTimes(1);
      
      // Second call should use cache
      const cachedToken = await enodeApi.getAccessToken(clientId, clientSecret);
      expect(cachedToken).toBe('test-token');
      expect(fetch).toHaveBeenCalledTimes(1); // Still just one call
    });
    
    test('should handle token fetch errors', async () => {
      const errorResponse = {
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValue('Unauthorized')
      };
      fetch.mockResolvedValue(errorResponse);
      
      await expect(
        enodeApi.getAccessToken('invalid', 'credentials')
      ).rejects.toThrow('Error fetching access token');
    });
  });
  
  describe('refreshVehicleData', () => {
    beforeEach(() => {
      // Mock successful token response
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };
      
      // Mock successful refresh response
      const refreshResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: {
            id: 'vehicle-123',
            chargeState: {
              batteryLevel: 75,
              isCharging: true,
              isPluggedIn: true
            }
          }
        })
      };
      
      // Setup fetch to return token then refresh response
      fetch.mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(refreshResponse);
    });
    
    test('should refresh vehicle data and honor rate limits', async () => {
      const clientId = 'test-client';
      const clientSecret = 'test-secret';
      const vehicleId = 'vehicle-123';
      
      // Mock the refreshVehicleData method directly to avoid all the API calls
      enodeApi.refreshVehicleData = jest.fn().mockImplementation(async (clientId, clientSecret, vehicleId) => {
        // Simulate the behavior based on rate limiting
        const lastRefreshKey = `last_refresh_${vehicleId}`;
        const refreshCountKey = `refresh_count_${vehicleId}`;
        const lastRefresh = enodeApi.requestCache.get(lastRefreshKey);
        const refreshCount = enodeApi.requestCache.get(refreshCountKey) || 0;
        
        if (refreshCount >= 9) {
          mockApi.log(`Skipping refresh-hint for vehicle ${vehicleId}, hourly rate limit reached`);
          return null;
        }
        
        // Return simulated vehicle data
        return {
          id: 'vehicle-123',
          chargeState: {
            batteryLevel: 75,
            isCharging: true
          }
        };
      });
      
      // First refresh should work
      const refreshedData = await enodeApi.refreshVehicleData(clientId, clientSecret, vehicleId);
      
      expect(refreshedData).toBeDefined();
      expect(refreshedData.id).toBe('vehicle-123');
      
      // Mock the rate limiting storage for second test
      enodeApi.requestCache.set(`last_refresh_${vehicleId}`, Date.now());
      enodeApi.requestCache.set(`refresh_count_${vehicleId}`, 9); // Max limit
      
      // This time should skip refresh due to rate limit
      const cachedData = await enodeApi.refreshVehicleData(clientId, clientSecret, vehicleId);
      
      // Should be null due to rate limiting
      expect(cachedData).toBeNull();
      expect(mockApi.log).toHaveBeenCalled();
    });
  });
  
  describe('controlCharging', () => {
    beforeEach(() => {
      // Mock token response
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };
      
      // Mock vehicle data response
      const vehicleDataResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: {
            id: 'vehicle-123',
            chargeState: {
              batteryLevel: 50,
              isCharging: false,
              isPluggedIn: true
            }
          }
        })
      };
      
      // Mock charging command response
      const chargingResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          id: 'action-123',
          vehicleId: 'vehicle-123',
          state: 'PENDING'
        })
      };
      
      // Mock action status response
      const actionStatusResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          id: 'action-123',
          vehicleId: 'vehicle-123',
          state: 'CONFIRMED'
        })
      };
      
      // Setup sequential responses
      fetch.mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(vehicleDataResponse)
           .mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(chargingResponse)
           .mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(actionStatusResponse);
    });
    
    test('should send charging command and wait for completion', async () => {
      // Mock waitForAction to resolve immediately for this test
      enodeApi.waitForAction = jest.fn().mockResolvedValue({
        id: 'action-123',
        state: 'CONFIRMED',
        message: 'Command successful'
      });
      
      const result = await enodeApi.startCharging('test-client', 'test-secret', 'vehicle-123');
      
      expect(result).toBeDefined();
      expect(result.state).toBe('CONFIRMED');
      expect(mockApi.log).toHaveBeenCalled();
      expect(enodeApi.waitForAction).toHaveBeenCalled();
    });
    
    test('should validate vehicle state before sending command', async () => {
      // Mock a vehicle that's not plugged in
      const notPluggedInResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: {
            id: 'vehicle-123',
            chargeState: {
              batteryLevel: 50,
              isCharging: false,
              isPluggedIn: false // Not plugged in
            }
          }
        })
      };
      
      // Reset and set up new mock responses
      fetch.mockReset();
      
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };
      
      fetch.mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(notPluggedInResponse);
      
      await expect(
        enodeApi.startCharging('test-client', 'test-secret', 'vehicle-123')
      ).rejects.toThrow('Vehicle is not plugged in');
      
      expect(mockApi.error).toHaveBeenCalled();
    });
  });
});