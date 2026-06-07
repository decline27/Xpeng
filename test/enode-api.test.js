const EnodeAPI = require('../lib/enode-api');
const fetch = require('node-fetch'); // globally mocked in test/setup.js
const { clearTokenCache } = require('../lib/enode-machine-token');
const HomeyMock = require('homey'); // mapped to test/mocks/homey.js

/**
 * Build an in-memory Homey instance suitable for constructing EnodeAPI.
 * EnodeAPI(api) treats `api` as the Homey object: it needs settings (get/set),
 * cloud.getHomeyId (stable user id), and log/error.
 */
function makeHomey() {
    const store = {};
    return {
        id: undefined,
        settings: {
            get: (k) => (k in store ? store[k] : null),
            set: (k, v) => { store[k] = v; },
        },
        cloud: { getHomeyId: jest.fn().mockResolvedValue('test-homey-id') },
        log: jest.fn(),
        error: jest.fn(),
        _store: store,
    };
}

// Helpers for building mocked fetch responses
const okJson = (body) => ({ ok: true, json: jest.fn().mockResolvedValue(body) });
const tokenResponse = () => okJson({ access_token: 'test-token', expires_in: 3600 });

describe('EnodeAPI', () => {
    let enodeApi;
    let homey;

    beforeEach(() => {
        jest.resetAllMocks();
        clearTokenCache(); // module-level machine-token cache must not leak between tests
        HomeyMock.env = {}; // avoid the legacy Homey.env.* access path during ClientManager init

        homey = makeHomey();
        enodeApi = new EnodeAPI(homey);
        // Register one client so credential lookups resolve without env.json.
        enodeApi.clientManager.addClient('primary', 'Primary Client', 'cid', 'secret', true);
    });

    describe('constructor', () => {
        test('should initialize with production environment by default', () => {
            expect(enodeApi.oauthBaseUrl).toBe('https://oauth.production.enode.io');
            expect(enodeApi.apiBaseUrl).toBe('https://enode-api.production.enode.io');
        });

        test('should initialize with staging environment when specified', () => {
            enodeApi = new EnodeAPI(homey, 'staging');
            expect(enodeApi.oauthBaseUrl).toBe('https://oauth.staging.enode.io');
            expect(enodeApi.apiBaseUrl).toBe('https://enode-api.staging.enode.io');
        });

        test('should fallback to production for invalid environment', () => {
            enodeApi = new EnodeAPI(homey, 'invalid');
            expect(enodeApi.oauthBaseUrl).toBe('https://oauth.production.enode.io');
            expect(enodeApi.apiBaseUrl).toBe('https://enode-api.production.enode.io');
        });
    });

    describe('makeRequest', () => {
        test('should call fetch with correct parameters', async () => {
            fetch.mockResolvedValue(okJson({}));
            const url = 'https://test-api.com/endpoint';
            const options = { method: 'GET', headers: { 'Content-Type': 'application/json' } };

            await enodeApi.makeRequest(url, options);

            expect(fetch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                signal: expect.any(Object),
            }));
        });

        test('should throw error for non-ok response', async () => {
            fetch.mockResolvedValue({ ok: false, status: 404, text: jest.fn().mockResolvedValue('Not Found') });
            await expect(enodeApi.makeRequest('https://test-api.com/error', {})).rejects.toThrow('HTTP error! status: 404');
        });

        test('should handle network errors', async () => {
            fetch.mockRejectedValue(new Error('Network failure'));
            await expect(enodeApi.makeRequest('https://test-api.com/endpoint', {})).rejects.toThrow('Network failure');
        });

        test('should handle timeout errors', async () => {
            const abortError = new Error('The operation was aborted');
            abortError.name = 'AbortError';
            fetch.mockRejectedValue(abortError);
            await expect(enodeApi.makeRequest('https://test-api.com/endpoint', {}, 100)).rejects.toThrow('The operation was aborted');
        });

        test('should return response object for successful requests', async () => {
            const mockResponse = okJson({ success: true });
            fetch.mockResolvedValue(mockResponse);

            const result = await enodeApi.makeRequest('https://test-api.com/endpoint', {});

            expect(result).toEqual(mockResponse);
            expect(mockResponse.json).not.toHaveBeenCalled(); // makeRequest returns the raw response
        });
    });

    describe('getAccessToken', () => {
        test('should fetch and cache the machine token per client', async () => {
            fetch.mockResolvedValue(tokenResponse());

            const token = await enodeApi.getAccessToken(null, 'primary');
            expect(token).toBe('test-token');
            expect(fetch).toHaveBeenCalledTimes(1);

            // Second call for the same client should hit the cache, not the network.
            const cached = await enodeApi.getAccessToken(null, 'primary');
            expect(cached).toBe('test-token');
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        test('should wrap token fetch errors', async () => {
            fetch.mockResolvedValue({ ok: false, status: 401, text: jest.fn().mockResolvedValue('Unauthorized') });
            await expect(enodeApi.getAccessToken(null, 'primary')).rejects.toThrow('Error fetching access token');
        });

        test('should re-request a token after the cache is cleared', async () => {
            fetch.mockResolvedValue(tokenResponse());

            await enodeApi.getAccessToken(null, 'primary');
            expect(fetch).toHaveBeenCalledTimes(1);

            clearTokenCache();

            await enodeApi.getAccessToken(null, 'primary');
            expect(fetch).toHaveBeenCalledTimes(2);
        });
    });

    describe('generateVehicleLink', () => {
        test('should generate a vehicle link for a new user', async () => {
            enodeApi.findClientForUser = jest.fn().mockResolvedValue(null); // new user → rotation
            enodeApi.getAccessToken = jest.fn().mockResolvedValue('test-token');
            fetch.mockResolvedValue(okJson({ linkUrl: 'https://link.example.com/vehicle' }));

            const result = await enodeApi.generateVehicleLink('user-123');
            expect(result).toBe('https://link.example.com/vehicle');
        });

        test('should pin an existing user to their current client (no rotation)', async () => {
            enodeApi.findClientForUser = jest.fn().mockResolvedValue('primary');
            enodeApi.getAccessToken = jest.fn().mockResolvedValue('test-token');
            fetch.mockResolvedValue(okJson({ linkUrl: 'https://link.example.com/vehicle' }));

            const result = await enodeApi.generateVehicleLink('returning-user');

            expect(result).toBe('https://link.example.com/vehicle');
            expect(enodeApi.findClientForUser).toHaveBeenCalledWith('returning-user');
            expect(enodeApi.getAccessToken).toHaveBeenCalledWith(null, 'primary');
        });

        test('should reject when the link URL is missing from the response', async () => {
            enodeApi.findClientForUser = jest.fn().mockResolvedValue(null);
            enodeApi.getAccessToken = jest.fn().mockResolvedValue('test-token');
            fetch.mockResolvedValue(okJson({}));

            await expect(enodeApi.generateVehicleLink('user-123')).rejects.toThrow('Link URL missing from response');
        });
    });

    describe('getVehicles', () => {
        test('should fetch and cache vehicles for a client', async () => {
            enodeApi.getAccessToken = jest.fn().mockResolvedValue('test-token');
            fetch.mockResolvedValue(okJson({
                data: [
                    { id: 'vehicle-1', information: { vin: 'VIN1' } },
                    { id: 'vehicle-2', information: { vin: 'VIN2' } },
                ],
            }));

            const vehicles = await enodeApi.getVehicles(null, true, true);
            expect(vehicles).toHaveLength(2);
            expect(vehicles.map(v => v.id)).toEqual(expect.arrayContaining(['vehicle-1', 'vehicle-2']));

            // Second call uses the per-client cache (no extra fetch).
            await enodeApi.getVehicles(null, true, true);
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        test('should return empty and log on invalid response format', async () => {
            enodeApi.getAccessToken = jest.fn().mockResolvedValue('test-token');
            fetch.mockResolvedValue(okJson({ vehicles: [] })); // wrong shape (no data array)

            const vehicles = await enodeApi.getVehicles(null, true, true);

            expect(vehicles).toEqual([]);
            expect(homey.error).toHaveBeenCalled();
        });
    });

    describe('getVehicleData', () => {
        test('should fetch and cache vehicle data', async () => {
            enodeApi.getAccessToken = jest.fn().mockResolvedValue('test-token');
            fetch.mockResolvedValue(okJson({ data: { id: 'vehicle-123', chargeState: { batteryLevel: 75 } } }));

            const data = await enodeApi.getVehicleData('vehicle-123', 'primary');
            expect(data.id).toBe('vehicle-123');

            const cached = await enodeApi.getVehicleData('vehicle-123', 'primary');
            expect(cached).toEqual(data);
            expect(fetch).toHaveBeenCalledTimes(1);
        });

        test('should reject on invalid vehicle data format', async () => {
            enodeApi.getAccessToken = jest.fn().mockResolvedValue('test-token');
            fetch.mockResolvedValue(okJson({ someOtherData: {} }));

            await expect(enodeApi.getVehicleData('vehicle-123', 'primary')).rejects.toThrow('Invalid vehicle data format');
            expect(homey.error).toHaveBeenCalled();
        });
    });

    describe('waitForAction', () => {
        beforeEach(() => {
            enodeApi.getAccessToken = jest.fn().mockResolvedValue('test-token');
        });

        test('should resolve when the action is confirmed', async () => {
            fetch
                .mockResolvedValueOnce(okJson({ id: 'action-123', state: 'PENDING' }))
                .mockResolvedValueOnce(okJson({ id: 'action-123', state: 'CONFIRMED', message: 'done' }));

            const result = await enodeApi.waitForAction('action-123', 10, 5);

            expect(result.state).toBe('CONFIRMED');
            expect(result.id).toBe('action-123');
        });

        test('should throw when the action fails', async () => {
            fetch.mockResolvedValue(okJson({ id: 'action-123', state: 'FAILED', failureReason: 'Vehicle not responding' }));
            await expect(enodeApi.waitForAction('action-123', 10, 5)).rejects.toThrow('Action failed: Vehicle not responding');
        });

        test('should throw when the action is cancelled', async () => {
            fetch.mockResolvedValue(okJson({ id: 'action-123', state: 'CANCELLED' }));
            await expect(enodeApi.waitForAction('action-123', 10, 5)).rejects.toThrow('Action was cancelled');
        });

        test('should throw when the action times out', async () => {
            fetch.mockResolvedValue(okJson({ id: 'action-123', state: 'PENDING' }));
            await expect(enodeApi.waitForAction('action-123', 10, 2)).rejects.toThrow('Action timed out after');
        });
    });

    describe('refreshVehicleData', () => {
        test('should skip refresh-hint when the minimum interval has not elapsed', async () => {
            enodeApi.getAccessToken = jest.fn().mockResolvedValue('test-token');
            enodeApi.getVehicleData = jest.fn().mockResolvedValue({ id: 'vehicle-123' });
            fetch.mockResolvedValue(okJson({}));

            // First refresh sends the hint.
            await enodeApi.refreshVehicleData('vehicle-123', 0);
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/refresh-hint'), expect.anything());

            // Within the interval, the hint must be skipped.
            fetch.mockClear();
            await enodeApi.refreshVehicleData('vehicle-123', 0);
            expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/refresh-hint'), expect.anything());
            expect(enodeApi.getVehicleData).toHaveBeenCalled();
        });

        test('should skip refresh-hint once the hourly rate limit is reached', async () => {
            enodeApi.getAccessToken = jest.fn().mockResolvedValue('test-token');
            enodeApi.getVehicleData = jest.fn().mockResolvedValue({ id: 'vehicle-123' });
            fetch.mockResolvedValue(okJson({}));

            enodeApi.requestCache.set('refresh_count_vehicle-123', 9);

            await enodeApi.refreshVehicleData('vehicle-123');

            expect(homey.log).toHaveBeenCalledWith(
                expect.stringContaining('Skipping refresh-hint'),
            );
            expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/refresh-hint'), expect.anything());
        });

        test('should return fresh data after a successful refresh-hint', async () => {
            enodeApi.getAccessToken = jest.fn().mockResolvedValue('test-token');
            enodeApi.getVehicleData = jest.fn().mockResolvedValue({ id: 'vehicle-123', chargeState: { batteryLevel: 76 } });
            fetch.mockResolvedValue(okJson({}));

            const result = await enodeApi.refreshVehicleData('vehicle-123', 0);

            expect(result.chargeState.batteryLevel).toBe(76);
            expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/refresh-hint'), expect.anything());
        });
    });

    describe('controlCharging', () => {
        beforeEach(() => {
            // The vehicle lives on the 'secondary' client (not the default). Control commands
            // must resolve and use that client, otherwise Enode rejects them ("read only" bug).
            enodeApi.getVehicles = jest.fn().mockResolvedValue([
                { id: 'vehicle-123', _accountId: 'secondary', _clientId: 'secondary', information: { vin: 'VINX' } },
            ]);
        });

        test('should reject invalid charging actions', async () => {
            await expect(enodeApi.controlCharging('vehicle-123', 'INVALID_ACTION')).rejects.toThrow('Invalid charging action: INVALID_ACTION');
        });

        test('should throw when the vehicle is not plugged in', async () => {
            enodeApi.getVehicleData = jest.fn().mockResolvedValue({ chargeState: { isPluggedIn: false } });
            await expect(enodeApi.startCharging('vehicle-123')).rejects.toThrow('Vehicle is not plugged in');
        });

        test('should throw when trying to charge a full battery', async () => {
            enodeApi.getVehicleData = jest.fn().mockResolvedValue({ chargeState: { isPluggedIn: true, batteryLevel: 100 } });
            await expect(enodeApi.startCharging('vehicle-123')).rejects.toThrow('Battery is already full');
        });

        test('should short-circuit STOP when already not charging', async () => {
            enodeApi.getVehicleData = jest.fn().mockResolvedValue({ chargeState: { isPluggedIn: true, isCharging: false } });

            const result = await enodeApi.stopCharging('vehicle-123');

            expect(result.state).toBe('CONFIRMED');
            expect(result.message).toContain('already not charging');
        });

        test('should send the charging command and wait for the action', async () => {
            enodeApi.getVehicleData = jest.fn().mockResolvedValue({ chargeState: { isPluggedIn: true, isCharging: true } });
            enodeApi.getAccessToken = jest.fn().mockResolvedValue('test-token');
            enodeApi.waitForAction = jest.fn().mockResolvedValue({ id: 'action-123', state: 'CONFIRMED' });
            fetch.mockResolvedValue(okJson({ id: 'action-123', state: 'PENDING' }));

            const result = await enodeApi.stopCharging('vehicle-123');

            expect(result.state).toBe('CONFIRMED');
            expect(fetch).toHaveBeenCalledWith(
                expect.stringContaining('/charging'),
                expect.objectContaining({ method: 'POST', body: expect.stringContaining('"action":"STOP"') }),
            );
        });

        test('should use the vehicle\'s resolved client for the command token (read-only bug fix)', async () => {
            enodeApi.getVehicleData = jest.fn().mockResolvedValue({ chargeState: { isPluggedIn: true, isCharging: true } });
            enodeApi.getAccessToken = jest.fn().mockResolvedValue('test-token');
            enodeApi.waitForAction = jest.fn().mockResolvedValue({ id: 'action-123', state: 'CONFIRMED' });
            fetch.mockResolvedValue(okJson({ id: 'action-123', state: 'PENDING' }));

            // No explicit accountId — controlCharging must resolve 'secondary' from getVehicles.
            await enodeApi.stopCharging('vehicle-123');

            expect(enodeApi.getAccessToken).toHaveBeenCalledWith('vehicle-123', 'secondary');
        });

        test('should honour an explicitly provided client without re-resolving', async () => {
            enodeApi.getVehicleData = jest.fn().mockResolvedValue({ chargeState: { isPluggedIn: true, isCharging: true } });
            enodeApi.getAccessToken = jest.fn().mockResolvedValue('test-token');
            enodeApi.waitForAction = jest.fn().mockResolvedValue({ id: 'action-123', state: 'CONFIRMED' });
            fetch.mockResolvedValue(okJson({ id: 'action-123', state: 'PENDING' }));

            await enodeApi.stopCharging('vehicle-123', 'client_3');

            expect(enodeApi.getVehicles).not.toHaveBeenCalled(); // no resolution needed
            expect(enodeApi.getAccessToken).toHaveBeenCalledWith('vehicle-123', 'client_3');
        });

        test('should invalidate the vehicle data cache after a charging action', async () => {
            enodeApi.getVehicleData = jest.fn().mockResolvedValue({ chargeState: { isPluggedIn: true, isCharging: false } });
            enodeApi.getAccessToken = jest.fn().mockResolvedValue('test-token');
            enodeApi.waitForAction = jest.fn().mockResolvedValue({ id: 'action-123', state: 'CONFIRMED' });
            fetch.mockResolvedValue(okJson({ id: 'action-123', state: 'PENDING' }));

            const clearSpy = jest.spyOn(enodeApi.requestCache, 'clear');

            await enodeApi.startCharging('vehicle-123');

            expect(clearSpy).toHaveBeenCalledWith('vehicle_vehicle-123');
            clearSpy.mockRestore();
        });
    });
});
