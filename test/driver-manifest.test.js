const path = require('path');

const root = path.join(__dirname, '..');
const driver = require(path.join(root, 'drivers/cars/driver.compose.json'));
const settings = require(path.join(root, 'drivers/cars/driver.settings.compose.json'));
const capability = (id) => require(path.join(root, '.homeycompose/capabilities', `${id}.json`));
const flowCard = (type, id) => require(path.join(root, '.homeycompose/flow', type, `${id}.json`));

const allSettings = settings.flatMap((s) => (s.type === 'group' ? s.children : [s]));
const setting = (id) => allSettings.find((s) => s.id === id);

describe('driver manifest', () => {
    test('uses the car device class', () => {
        expect(driver.class).toBe('car');
    });

    test('declares the car for Homey Energy instead of a replaceable battery', () => {
        expect(driver.energy).toEqual({ electricCar: true });
    });

    test.each(['measure_battery', 'measure_power', 'ev_charging_state'])('includes the standard %s capability', (id) => {
        expect(driver.capabilities).toContain(id);
    });

    test('keeps settings only in driver.settings.compose.json (no stale copy here)', () => {
        expect(driver.settings).toBeUndefined();
    });

    test('has a repair flow so a re-linked car can be fixed without removing the device', () => {
        expect(Array.isArray(driver.repair)).toBe(true);
        expect(driver.repair.length).toBeGreaterThan(0);
    });
});

describe('device settings', () => {
    test('keeps the update interval between 10 and 60 minutes', () => {
        expect(setting('updateInterval')).toMatchObject({ type: 'number', min: 10, max: 60, value: 10 });
    });

    test('offers kilometres or miles', () => {
        const unit = setting('distanceUnit');
        expect(unit.type).toBe('dropdown');
        expect(unit.value).toBe('km');
        expect(unit.values.map((v) => v.id)).toEqual(['km', 'mi']);
    });

    test.each(['info_vehicle_id', 'info_vin', 'info_last_sync'])('shows %s as a read-only label', (id) => {
        expect(setting(id)).toMatchObject({ type: 'label' });
    });
});

describe('capabilities', () => {
    test('charging limit is read-only (Enode has no command to change it)', () => {
        expect(capability('chargingLimit').setable).toBe(false);
    });

    test('power delivery state has a translatable title and no invalid options', () => {
        const pds = capability('powerDeliveryState');
        expect(typeof pds.title).toBe('object');
        expect(pds.options).toBeUndefined();
    });
});

describe('distance-based flow cards', () => {
    test.each([
        ['triggers', 'range_low'],
        ['conditions', 'range_check'],
    ])('%s/%s does not hard-code km, because the unit is a setting', (type, id) => {
        expect(flowCard(type, id).titleFormatted.en).not.toMatch(/\bkm\b/);
    });
});
