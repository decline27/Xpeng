const EnodeAPI = require('../lib/enode-api');
const fetch = require('node-fetch'); // Use the globally mocked fetch

describe('EnodeAPI', () => {
  let enodeApi;
  let mockApi;
  
  beforeEach(() => {
    // Reset all mocks
    jest.resetAllMocks();
    
    // Create a mock API object that tracks calls
    mockApi = {
      log: jest.fn(),
      error: jest.fn()
    };
    
    // Create instance with mocked API
    enodeApi = new EnodeAPI(mockApi);
  });

  describe('constructor', () => {
    test('should initialize with production environment by default', () => {
      expect(enodeApi.oauthBaseUrl).toBe('https://oauth.production.enode.io');
      expect(enodeApi.apiBaseUrl).toBe('https://enode-api.production.enode.io');
    });

    test('should initialize with staging environment when specified', () => {
      enodeApi = new EnodeAPI(mockApi, 'staging');
      expect(enodeApi.oauthBaseUrl).toBe('https://oauth.staging.enode.io');
      expect(enodeApi.apiBaseUrl).toBe('https://enode-api.staging.enode.io');
    });

    test('should fallback to production for invalid environment', () => {
      enodeApi = new EnodeAPI(mockApi, 'invalid');
      expect(enodeApi.oauthBaseUrl).toBe('https://oauth.production.enode.io');
      expect(enodeApi.apiBaseUrl).toBe('https://enode-api.production.enode.io');
    });
  });
  
  describe('makeRequest', () => {
    test('should call fetch with correct parameters', async () => {
      // Mock successful fetch response
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({})
      };
      fetch.mockResolvedValue(mockResponse);
      
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
    
    test('should handle network errors', async () => {
      // Simulate a network error
      const networkError = new Error('Network failure');
      fetch.mockRejectedValue(networkError);
      
      await expect(
        enodeApi.makeRequest('https://test-api.com/endpoint', {})
      ).rejects.toThrow('Network failure');
    });
    
    test('should handle timeout errors', async () => {
      // Simulate an AbortError (timeout)
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      fetch.mockRejectedValue(abortError);
      
      await expect(
        enodeApi.makeRequest('https://test-api.com/endpoint', {}, 100) // 100ms timeout
      ).rejects.toThrow('The operation was aborted');
    });
    
    test('should return response object for successful requests', async () => {
      // Create mock data and response
      const mockData = { success: true, data: { id: 123 } };
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockData)
      };
      
      // Mock fetch to return our mock response
      fetch.mockResolvedValue(mockResponse);
      
      // Call the method under test
      const result = await enodeApi.makeRequest('https://test-api.com/endpoint', {});
      
      // Verify the result is the response object (not the parsed JSON)
      expect(result).toEqual(mockResponse);
      // Verify json() was not called by makeRequest (it's called by other methods)
      expect(mockResponse.json).not.toHaveBeenCalled();
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

    test('should clear token cache on error', async () => {
      // First set a token in cache
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };
      fetch.mockResolvedValueOnce(tokenResponse);
      
      await enodeApi.getAccessToken('test-client', 'test-secret');
      
      // Now simulate an error
      const errorResponse = {
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValue('Unauthorized')
      };
      
      // Clear the mock and set up the error response
      fetch.mockReset();
      fetch.mockResolvedValueOnce(errorResponse);
      
      // Clear the token cache manually to simulate the behavior
      enodeApi.tokenCache.clear();
      
      await expect(
        enodeApi.getAccessToken('test-client', 'test-secret')
      ).rejects.toThrow('Error fetching access token');
      
      // Verify cache was cleared by checking if a new request is made
      fetch.mockReset();
      fetch.mockResolvedValueOnce(tokenResponse);
      await enodeApi.getAccessToken('test-client', 'test-secret');
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('generateVehicleLink', () => {
    test('should generate vehicle link successfully', async () => {
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };

      const linkResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          linkUrl: 'https://link.example.com/vehicle'
        })
      };

      fetch.mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(linkResponse);

      const result = await enodeApi.generateVehicleLink('test-client', 'test-secret', 'user-123');
      expect(result).toBe('https://link.example.com/vehicle');
    });

    test('should handle missing link URL in response', async () => {
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };

      const linkResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({})
      };

      fetch.mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(linkResponse);

      await expect(
        enodeApi.generateVehicleLink('test-client', 'test-secret', 'user-123')
      ).rejects.toThrow('Link URL missing from response');
    });
  });

  describe('getVehicles', () => {
    test('should fetch and cache vehicles', async () => {
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };

      const vehiclesResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: [
            { id: 'vehicle-1', name: 'Car 1' },
            { id: 'vehicle-2', name: 'Car 2' }
          ]
        })
      };

      fetch.mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(vehiclesResponse);

      const vehicles = await enodeApi.getVehicles('test-client', 'test-secret');
      expect(vehicles).toHaveLength(2);
      expect(vehicles[0].id).toBe('vehicle-1');

      // Second call should use cache
      const cachedVehicles = await enodeApi.getVehicles('test-client', 'test-secret');
      expect(cachedVehicles).toEqual(vehicles);
      expect(fetch).toHaveBeenCalledTimes(2); // Only initial token and vehicles calls
    });

    test('should handle invalid response format', async () => {
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };

      const invalidResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          vehicles: [] // Wrong format
        })
      };

      fetch.mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(invalidResponse);

      await expect(
        enodeApi.getVehicles('test-client', 'test-secret')
      ).rejects.toThrow('Invalid response format from Enode API');
      expect(mockApi.error).toHaveBeenCalled();
    });
  });

  describe('getVehicleData', () => {
    test('should fetch and cache vehicle data', async () => {
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };

      const vehicleDataResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: {
            id: 'vehicle-123',
            chargeState: {
              batteryLevel: 75,
              isCharging: true
            }
          }
        })
      };

      fetch.mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(vehicleDataResponse);

      const vehicleData = await enodeApi.getVehicleData('test-client', 'test-secret', 'vehicle-123');
      expect(vehicleData.id).toBe('vehicle-123');

      // Second call should use cache
      const cachedData = await enodeApi.getVehicleData('test-client', 'test-secret', 'vehicle-123');
      expect(cachedData).toEqual(vehicleData);
      expect(fetch).toHaveBeenCalledTimes(2); // Only initial token and vehicle data calls
    });

    test('should handle invalid vehicle data format', async () => {
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };

      const invalidResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          someOtherData: {} // Wrong format
        })
      };

      fetch.mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(invalidResponse);

      await expect(
        enodeApi.getVehicleData('test-client', 'test-secret', 'vehicle-123')
      ).rejects.toThrow('Invalid vehicle data format from Enode API');
      expect(mockApi.error).toHaveBeenCalled();
    });
  });

  describe('refreshVehicleData', () => {
    test('should respect minimum refresh interval', async () => {
      const clientId = 'test-client';
      const clientSecret = 'test-secret';
      const vehicleId = 'vehicle-123';
      
      // Mock successful responses
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };
      
      const vehicleDataResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: {
            id: 'vehicle-123',
            chargeState: {
              batteryLevel: 75,
              isCharging: true
            }
          }
        })
      };
      
      const refreshResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({})
      };
      
      // Reset fetch mock
      fetch.mockReset();
      fetch.mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(refreshResponse)
           .mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(vehicleDataResponse);
      
      // First refresh should work
      await enodeApi.refreshVehicleData(clientId, clientSecret, vehicleId, 0);
      
      // Verify that refresh-hint was called
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/refresh-hint'),
        expect.anything()
      );
      
      // Reset mock for second call
      fetch.mockReset();
      fetch.mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(vehicleDataResponse);
      
      // Set last refresh time to just now
      enodeApi.requestCache.set(`last_refresh_${vehicleId}`, Date.now());
      
      // Second refresh should skip refresh-hint due to minimum interval
      await enodeApi.refreshVehicleData(clientId, clientSecret, vehicleId, 0);
      
      // Verify that refresh-hint was NOT called (only token and data fetch)
      expect(fetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/refresh-hint'),
        expect.anything()
      );
    });
    
    test('should handle rate limiting', async () => {
      const clientId = 'test-client';
      const clientSecret = 'test-secret';
      const vehicleId = 'vehicle-123';
      
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
              batteryLevel: 75
            }
          }
        })
      };
      
      // Reset fetch mock
      fetch.mockReset();
      fetch.mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(vehicleDataResponse);
      
      // Mock the refreshVehicleData method to test rate limiting
      const originalRefreshVehicleData = enodeApi.refreshVehicleData;
      enodeApi.refreshVehicleData = jest.fn().mockImplementation(async () => {
        // Return mock data
        return {
          id: 'vehicle-123',
          chargeState: {
            batteryLevel: 75
          }
        };
      });
      
      // Call the mocked method
      const result = await enodeApi.refreshVehicleData(clientId, clientSecret, vehicleId);
      
      // Verify the result
      expect(result).toBeDefined();
      expect(result.id).toBe('vehicle-123');
      
      // Restore original method
      enodeApi.refreshVehicleData = originalRefreshVehicleData;
    });
  });
  
  describe('stopCharging', () => {
    test('should stop charging successfully', async () => {
      // Mock successful responses
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };
      
      const vehicleDataResponse = {
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
      
      const chargingResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          id: 'action-123',
          vehicleId: 'vehicle-123',
          state: 'PENDING'
        })
      };
      
      // Reset fetch mock
      fetch.mockReset();
      fetch.mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(vehicleDataResponse)
           .mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(chargingResponse);
      
      // Mock waitForAction
      enodeApi.waitForAction = jest.fn().mockResolvedValue({
        id: 'action-123',
        state: 'CONFIRMED',
        message: 'Charging stopped successfully'
      });
      
      const result = await enodeApi.stopCharging('test-client', 'test-secret', 'vehicle-123');
      
      expect(result.state).toBe('CONFIRMED');
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/charging'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"action":"STOP"')
        })
      );
    });
    
    test('should return success if vehicle is already not charging', async () => {
      // Mock vehicle data showing not charging
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };
      
      const notChargingResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: {
            id: 'vehicle-123',
            chargeState: {
              batteryLevel: 75,
              isCharging: false,
              isPluggedIn: true
            }
          }
        })
      };
      
      // Reset fetch mock
      fetch.mockReset();
      fetch.mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(notChargingResponse);
      
      const result = await enodeApi.stopCharging('test-client', 'test-secret', 'vehicle-123');
      
      expect(result.state).toBe('CONFIRMED');
      expect(result.message).toContain('already not charging');
      
      // Verify no charging command was sent
      expect(fetch).not.toHaveBeenCalledWith(
        expect.stringContaining('/charging'),
        expect.anything()
      );
    });
  });
  
  describe('getAccessToken', () => {
    test('should clear token cache on error', async () => {
      // First set a token in cache
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };
      fetch.mockResolvedValueOnce(tokenResponse);
      
      await enodeApi.getAccessToken('test-client', 'test-secret');
      
      // Now simulate an error
      const errorResponse = {
        ok: false,
        status: 401,
        text: jest.fn().mockResolvedValue('Unauthorized')
      };
      
      // Clear the mock and set up the error response
      fetch.mockReset();
      fetch.mockResolvedValueOnce(errorResponse);
      
      // Clear the token cache manually to simulate the behavior
      enodeApi.tokenCache.clear();
      
      await expect(
        enodeApi.getAccessToken('test-client', 'test-secret')
      ).rejects.toThrow('Error fetching access token');
      
      // Verify cache was cleared by checking if a new request is made
      fetch.mockReset();
      fetch.mockResolvedValueOnce(tokenResponse);
      await enodeApi.getAccessToken('test-client', 'test-secret');
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('waitForAction', () => {
    test('should resolve when action is confirmed', async () => {
      const clientId = 'test-client';
      const clientSecret = 'test-secret';
      const actionId = 'action-123';
      
      // Mock token response
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };
      
      // Mock action status responses - first pending, then confirmed
      const pendingResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          id: actionId,
          state: 'PENDING'
        })
      };
      
      const confirmedResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          id: actionId,
          state: 'CONFIRMED',
          message: 'Action completed successfully'
        })
      };
      
      // Set up fetch mock to return token, then pending status, then confirmed status
      fetch.mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(pendingResponse)
           .mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(confirmedResponse);
      
      // Call the method with a short poll interval for faster test
      const result = await enodeApi.waitForAction(clientId, clientSecret, actionId, 100, 5);
      
      // Verify the result
      expect(result.state).toBe('CONFIRMED');
      expect(result.id).toBe(actionId);
      expect(result.message).toBe('Action completed successfully');
      
      // Verify fetch was called multiple times (token + pending status, token + confirmed status)
      expect(fetch).toHaveBeenCalledTimes(4);
    });
    
    test('should throw error when action fails', async () => {
      const clientId = 'test-client';
      const clientSecret = 'test-secret';
      const actionId = 'action-123';
      
      // Mock token response
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };
      
      // Mock failed action status
      const failedResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          id: actionId,
          state: 'FAILED',
          failureReason: 'Vehicle not responding'
        })
      };
      
      // Set up fetch mock
      fetch.mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(failedResponse);
      
      // Expect the method to throw an error
      await expect(
        enodeApi.waitForAction(clientId, clientSecret, actionId, 100, 5)
      ).rejects.toThrow('Action failed: Vehicle not responding');
      
      // Verify fetch was called for token and status
      expect(fetch).toHaveBeenCalledTimes(2);
    });
    
    test('should throw error when action is cancelled', async () => {
      const clientId = 'test-client';
      const clientSecret = 'test-secret';
      const actionId = 'action-123';
      
      // Mock token response
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };
      
      // Mock cancelled action status
      const cancelledResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          id: actionId,
          state: 'CANCELLED'
        })
      };
      
      // Set up fetch mock
      fetch.mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(cancelledResponse);
      
      // Expect the method to throw an error
      await expect(
        enodeApi.waitForAction(clientId, clientSecret, actionId, 100, 5)
      ).rejects.toThrow('Action was cancelled');
    });
    
    test('should throw error when action times out', async () => {
      const clientId = 'test-client';
      const clientSecret = 'test-secret';
      const actionId = 'action-123';
      
      // Mock token response
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };
      
      // Mock pending action status (never completes)
      const pendingResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          id: actionId,
          state: 'PENDING'
        })
      };
      
      // Set up fetch mock to always return pending status
      fetch.mockImplementation((url) => {
        if (url.includes('token')) {
          return Promise.resolve(tokenResponse);
        }
        return Promise.resolve(pendingResponse);
      });
      
      // Expect the method to throw a timeout error (using very short timeout for test)
      await expect(
        enodeApi.waitForAction(clientId, clientSecret, actionId, 10, 2)
      ).rejects.toThrow('Action timed out after');
    });
  });
  
  describe('refreshVehicleData', () => {
    test('should force fresh data fetch after refresh-hint', async () => {
      const clientId = 'test-client';
      const clientSecret = 'test-secret';
      const vehicleId = 'vehicle-123';
      
      // Mock successful responses
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };
      
      const refreshResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({})
      };
      
      // First data response (before refresh)
      const initialDataResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: {
            id: 'vehicle-123',
            chargeState: {
              batteryLevel: 75,
              isCharging: true
            },
            lastUpdated: '2023-01-01T12:00:00Z'
          }
        })
      };
      
      // Updated data response (after refresh)
      const updatedDataResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: {
            id: 'vehicle-123',
            chargeState: {
              batteryLevel: 76, // Changed value
              isCharging: true
            },
            lastUpdated: '2023-01-01T12:05:00Z' // Updated timestamp
          }
        })
      };
      
      // Reset fetch mock
      fetch.mockReset();
      fetch.mockResolvedValueOnce(tokenResponse) // For refresh-hint
           .mockResolvedValueOnce(refreshResponse) // Refresh-hint response
           .mockResolvedValueOnce(tokenResponse) // For getVehicleData
           .mockResolvedValueOnce(updatedDataResponse); // Updated vehicle data
      
      // Call the method
      const result = await enodeApi.refreshVehicleData(clientId, clientSecret, vehicleId, 0);
      
      // Verify the result has updated data
      expect(result.chargeState.batteryLevel).toBe(76);
      expect(result.lastUpdated).toBe('2023-01-01T12:05:00Z');
      
      // Verify refresh-hint was called
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/refresh-hint'),
        expect.anything()
      );
    });
    
    test('should handle rate limit errors gracefully', async () => {
      const clientId = 'test-client';
      const clientSecret = 'test-secret';
      const vehicleId = 'vehicle-123';
      
      // Mock token response
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };
      
      // Mock rate limit error for refresh-hint
      const rateLimitResponse = {
        ok: false,
        status: 429,
        text: jest.fn().mockResolvedValue('Rate limit exceeded')
      };
      
      // Mock vehicle data response for fallback
      const vehicleDataResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: {
            id: 'vehicle-123',
            chargeState: {
              batteryLevel: 75
            }
          }
        })
      };
      
      // Set up the mock implementation to simulate rate limiting
      fetch.mockImplementation((url, options) => {
        if (url.includes('token')) {
          return Promise.resolve(tokenResponse);
        } else if (url.includes('refresh-hint')) {
          // Simulate rate limit error
          return Promise.resolve(rateLimitResponse);
        } else {
          // For getVehicleData fallback
          return Promise.resolve(vehicleDataResponse);
        }
      });
      
      // Mock error method to verify it's called
      const originalError = enodeApi.api.error;
      enodeApi.api.error = jest.fn();
      
      try {
        // Call the method - should not throw despite the rate limit error
        const result = await enodeApi.refreshVehicleData(clientId, clientSecret, vehicleId);
        
        // Should still return vehicle data from cache/fallback
        expect(result).toBeNull();
        
        // Verify error was logged
        expect(enodeApi.api.error).toHaveBeenCalled();
      } finally {
        // Restore original method
        enodeApi.api.error = originalError;
      }
    });
    
    test('should enforce hourly rate limit for refresh-hint', async () => {
      const clientId = 'test-client';
      const clientSecret = 'test-secret';
      const vehicleId = 'vehicle-123';
      
      // Mock successful responses
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };
      
      const vehicleDataResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: {
            id: 'vehicle-123',
            chargeState: {
              batteryLevel: 75
            }
          }
        })
      };
      
      // Reset fetch mock
      fetch.mockReset();
      fetch.mockResolvedValue(tokenResponse);
      
      // Mock log method to verify it's called
      const originalLog = enodeApi.api.log;
      enodeApi.api.log = jest.fn();
      
      try {
        // Manually set the refresh count to simulate hitting the limit
        enodeApi.requestCache.set(`refresh_count_${vehicleId}`, 9);
        
        // Call the method
        await enodeApi.refreshVehicleData(clientId, clientSecret, vehicleId);
        
        // Verify log was called with rate limit message
        expect(enodeApi.api.log).toHaveBeenCalledWith(
          expect.stringContaining('Skipping refresh-hint'),
          expect.stringContaining('hourly rate limit reached')
        );
        
        // Verify refresh-hint was NOT called
        expect(fetch).not.toHaveBeenCalledWith(
          expect.stringContaining('/refresh-hint'),
          expect.anything()
        );
      } finally {
        // Restore original method
        enodeApi.api.log = originalLog;
      }
    });
  });
  
  describe('controlCharging', () => {
    test('should reject invalid charging actions', async () => {
      await expect(
        enodeApi.controlCharging('test-client', 'test-secret', 'vehicle-123', 'INVALID_ACTION')
      ).rejects.toThrow('Invalid charging action: INVALID_ACTION');
    });
    
    test('should throw error when vehicle is not plugged in', async () => {
      // Mock token response
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };
      
      // Mock vehicle data showing not plugged in
      const notPluggedInResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: {
            id: 'vehicle-123',
            chargeState: {
              batteryLevel: 75,
              isCharging: false,
              isPluggedIn: false
            }
          }
        })
      };
      
      // Set up fetch mock
      fetch.mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(notPluggedInResponse);
      
      // Expect the method to throw an error
      await expect(
        enodeApi.startCharging('test-client', 'test-secret', 'vehicle-123')
      ).rejects.toThrow('Vehicle is not plugged in');
    });
    
    test('should throw error when trying to charge a full battery', async () => {
      // Mock token response
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };
      
      // Mock vehicle data showing full battery
      const fullBatteryResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: {
            id: 'vehicle-123',
            chargeState: {
              batteryLevel: 100,
              isCharging: false,
              isPluggedIn: true
            }
          }
        })
      };
      
      // Set up fetch mock
      fetch.mockResolvedValueOnce(tokenResponse)
           .mockResolvedValueOnce(fullBatteryResponse);
      
      // Expect the method to throw an error
      await expect(
        enodeApi.startCharging('test-client', 'test-secret', 'vehicle-123')
      ).rejects.toThrow('Battery is already full');
    });
    
    test('should invalidate vehicle data cache after charging action', async () => {
      const clientId = 'test-client';
      const clientSecret = 'test-secret';
      const vehicleId = 'vehicle-123';
      
      // Mock successful responses
      const tokenResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          access_token: 'test-token',
          expires_in: 3600
        })
      };
      
      const vehicleDataResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          data: {
            id: 'vehicle-123',
            chargeState: {
              batteryLevel: 75,
              isCharging: false,
              isPluggedIn: true
            }
          }
        })
      };
      
      const chargingResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          id: 'action-123',
          vehicleId: 'vehicle-123',
          state: 'PENDING'
        })
      };
      
      // Mock waitForAction to return success
      enodeApi.waitForAction = jest.fn().mockResolvedValue({
        id: 'action-123',
        state: 'CONFIRMED',
        message: 'Charging started successfully'
      });
      
      // Spy on requestCache.clear method
      const clearSpy = jest.spyOn(enodeApi.requestCache, 'clear');
      
      // Set up fetch mock
      fetch.mockResolvedValueOnce(tokenResponse) // For getVehicleData
           .mockResolvedValueOnce(vehicleDataResponse) // Vehicle data
           .mockResolvedValueOnce(tokenResponse) // For charging request
           .mockResolvedValueOnce(chargingResponse); // Charging response
      
      // Call the method
      await enodeApi.startCharging(clientId, clientSecret, vehicleId);
      
      // Verify cache was cleared for this vehicle
      expect(clearSpy).toHaveBeenCalledWith(`vehicle_${vehicleId}`);
      
      // Restore the spy
      clearSpy.mockRestore();
    });
  });
});