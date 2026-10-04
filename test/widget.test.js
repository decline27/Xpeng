const fetch = require('node-fetch'); // globally mocked in test/setup.js
const { buildWidgetData, findDevice, AddressLookup } = require('../lib/widget-data');
const widgetApi = require('../widgets/xpeng/api');

function fakeDevice(id, capabilities) {
    return {
        getId: () => id,
        getName: () => `Car ${id}`,
        getCapabilityValue: (cap) => capabilities[cap],
        pollVehicleData: jest.fn().mockResolvedValue(true),
        refreshData: jest.fn().mockResolvedValue(true),
        startCharging: jest.fn().mockResolvedValue(true),
        stopCharging: jest.fn().mockResolvedValue(true),
    };
}

function fakeHomey(devices) {
    return { drivers: { getDriver: jest.fn().mockResolvedValue({ getDevices: () => devices }) } };
}

const chargingCar = {
    batteryLevel: 62.4,
    range: 280,
    chargingStatus: 'Charging',
    pluggedInStatus: true,
    lastSeen: '2026-10-04 21:27',
    powerDeliveryState: 'Charging',
    chargingPower: 11000,
    location: '55.570°N, 13.054°E (55.570267,13.053961)',
    vehicleModel: 'G6',
};

describe('buildWidgetData', () => {
    test('marks a charging car as charging so the Stop button is enabled', () => {
        const data = buildWidgetData(fakeDevice('a', chargingCar));
        expect(data.isCharging).toBe(true);
        expect(data.canStartCharging).toBe(false);
    });

    test('allows starting when plugged in and not charging', () => {
        const data = buildWidgetData(fakeDevice('a', { ...chargingCar, chargingStatus: 'Connected', chargingPower: 0 }));
        expect(data.isCharging).toBe(false);
        expect(data.canStartCharging).toBe(true);
    });

    test('does not allow starting when unplugged', () => {
        const data = buildWidgetData(fakeDevice('a', { ...chargingCar, chargingStatus: 'Not Connected', pluggedInStatus: false }));
        expect(data.canStartCharging).toBe(false);
    });

    test('reports charging power in kW from chargingPower', () => {
        expect(buildWidgetData(fakeDevice('a', chargingCar)).chargingPowerKw).toBe(11);
    });

    test('keeps 0% battery and 0 km range instead of treating them as missing', () => {
        const data = buildWidgetData(fakeDevice('a', { ...chargingCar, batteryLevel: 0, range: 0 }));
        expect(data.batteryLevel).toBe(0);
        expect(data.range).toBe(0);
    });

    test('parses the coordinates out of the location capability', () => {
        expect(buildWidgetData(fakeDevice('a', chargingCar)).location)
            .toEqual({ latitude: 55.570267, longitude: 13.053961 });
    });

    test('returns a null location when the location is unavailable', () => {
        expect(buildWidgetData(fakeDevice('a', { ...chargingCar, location: 'Not Available' })).location).toBeNull();
    });
});

describe('findDevice', () => {
    const a = fakeDevice('a', chargingCar);
    const b = fakeDevice('b', chargingCar);

    test('returns the device the widget was configured for', () => {
        expect(findDevice([a, b], 'b')).toBe(b);
    });

    test('falls back to the first car for widgets without a selected device', () => {
        expect(findDevice([a, b], undefined)).toBe(a);
    });

    test('returns null when there are no cars', () => {
        expect(findDevice([], 'a')).toBeNull();
    });
});

describe('AddressLookup', () => {
    beforeEach(() => jest.resetAllMocks());

    const nominatim = (road) => ({
        ok: true,
        json: jest.fn().mockResolvedValue({ address: { road, house_number: '1', city: 'Lund' } }),
    });

    test('rounds coordinates before sending them to the geocoder', async () => {
        fetch.mockResolvedValue(nominatim('Storgatan'));
        await new AddressLookup().lookup(55.5702671, 13.0539612);
        const url = fetch.mock.calls[0][0];
        expect(url).toContain('lat=55.5703');
        expect(url).toContain('lon=13.054');
    });

    test('identifies the app in the User-Agent and sets a timeout signal', async () => {
        fetch.mockResolvedValue(nominatim('Storgatan'));
        await new AddressLookup().lookup(55.57, 13.05);
        const opts = fetch.mock.calls[0][1];
        expect(opts.headers['User-Agent']).toMatch(/XPENG.*Homey.*github\.com/);
        expect(opts.signal).toBeDefined();
    });

    test('serves repeated lookups from the cache', async () => {
        fetch.mockResolvedValue(nominatim('Storgatan'));
        const lookup = new AddressLookup();
        await lookup.lookup(55.57, 13.05);
        const second = await lookup.lookup(55.57, 13.05);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(second).toBe('Storgatan, 1, Lund');
    });

    test('keeps the cache bounded', async () => {
        fetch.mockImplementation(async () => nominatim('Road'));
        const lookup = new AddressLookup({ maxEntries: 3 });
        for (let i = 0; i < 10; i++) {
            await lookup.lookup(50 + i, 10);
        }
        expect(lookup.size).toBe(3);
    });

    test('returns null instead of throwing when the geocoder fails', async () => {
        fetch.mockRejectedValue(new Error('timeout'));
        await expect(new AddressLookup().lookup(55.57, 13.05)).resolves.toBeNull();
    });
});

describe('widget API', () => {
    beforeEach(() => {
        jest.resetAllMocks();
        fetch.mockResolvedValue({ ok: true, json: jest.fn().mockResolvedValue({ address: { road: 'Storgatan', city: 'Lund' } }) });
    });

    test('getVehicleData reads the device values and never polls Enode', async () => {
        const car = fakeDevice('a', chargingCar);
        const data = await widgetApi.getVehicleData({ homey: fakeHomey([car]), query: { deviceId: 'a' } });

        expect(car.pollVehicleData).not.toHaveBeenCalled();
        expect(data.batteryLevel).toBe(62.4);
        expect(data.isCharging).toBe(true);
    });

    test('getVehicleData returns the selected car', async () => {
        const a = fakeDevice('a', chargingCar);
        const b = fakeDevice('b', { ...chargingCar, vehicleModel: 'P7' });
        const data = await widgetApi.getVehicleData({ homey: fakeHomey([a, b]), query: { deviceId: 'b' } });
        expect(data.vehicleModel).toBe('P7');
    });

    test('getVehicleData reports a clear error when no car is paired', async () => {
        const data = await widgetApi.getVehicleData({ homey: fakeHomey([]), query: {} });
        expect(data.error).toMatch(/No XPENG vehicle/);
    });

    test('stopCharging controls the selected car, not the first one', async () => {
        const a = fakeDevice('a', chargingCar);
        const b = fakeDevice('b', chargingCar);
        await widgetApi.stopCharging({ homey: fakeHomey([a, b]), body: { deviceId: 'b' } });
        expect(b.stopCharging).toHaveBeenCalled();
        expect(a.stopCharging).not.toHaveBeenCalled();
    });

    test('startCharging controls the selected car', async () => {
        const a = fakeDevice('a', chargingCar);
        const b = fakeDevice('b', chargingCar);
        await widgetApi.startCharging({ homey: fakeHomey([a, b]), body: { deviceId: 'b' } });
        expect(b.startCharging).toHaveBeenCalled();
    });

    test('updateVehicleData asks the device to refresh', async () => {
        const car = fakeDevice('a', chargingCar);
        const res = await widgetApi.updateVehicleData({ homey: fakeHomey([car]), body: { deviceId: 'a' } });
        expect(car.refreshData).toHaveBeenCalled();
        expect(res.success).toBe(true);
    });

    test('exposes no background prefetch loop', () => {
        expect(widgetApi.schedulePrefetch).toBeUndefined();
        expect(widgetApi.prefetchVehicleData).toBeUndefined();
    });
});
