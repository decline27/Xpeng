const logic = require('../lib/flow-logic');

describe('compareNumber (battery and range conditions)', () => {
    test.each([
        [300, 'greater', 200, true],
        [300, 'lower', 200, false],
        [300, 'equals', 300, true],
        [150, 'lower', 200, true],
    ])('%s %s %s -> %s', (value, comparison, target, expected) => {
        expect(logic.compareNumber(value, comparison, target)).toBe(expected);
    });

    test('works with the numeric range capability (was always false)', () => {
        expect(logic.compareNumber(274, 'greater', 200)).toBe(true);
    });

    test('equals compares whole numbers, so 50.4% equals 50', () => {
        expect(logic.compareNumber(50.4, 'equals', 50)).toBe(true);
        expect(logic.compareNumber(50.6, 'equals', 50)).toBe(false);
    });

    test('returns false for missing values', () => {
        expect(logic.compareNumber(null, 'greater', 10)).toBe(false);
        expect(logic.compareNumber(undefined, 'lower', 10)).toBe(false);
        expect(logic.compareNumber(NaN, 'lower', 10)).toBe(false);
    });

    test('returns false for an unknown comparison', () => {
        expect(logic.compareNumber(10, 'between', 5)).toBe(false);
    });
});

describe('crossedBelow (battery low / range low triggers)', () => {
    test('fires once when the value drops below the threshold', () => {
        expect(logic.crossedBelow(21, 19, 20)).toBe(true);
    });

    test('only a value strictly below the threshold counts as dropping below it', () => {
        expect(logic.crossedBelow(21, 20, 20)).toBe(false);
        expect(logic.crossedBelow(20, 19.9, 20)).toBe(true);
    });

    test('does not fire again while the value stays below the threshold', () => {
        expect(logic.crossedBelow(19, 18, 20)).toBe(false);
        expect(logic.crossedBelow(18, 17.9, 20)).toBe(false);
    });

    test('does not fire while charging back up below the threshold', () => {
        expect(logic.crossedBelow(11, 12, 20)).toBe(false);
    });

    test('does not fire without a previous value', () => {
        expect(logic.crossedBelow(null, 5, 20)).toBe(false);
        expect(logic.crossedBelow(undefined, 5, 20)).toBe(false);
    });
});

describe('matchesChargingStatus', () => {
    test.each([
        ['charging', 'Charging', true],
        ['charging', 'Connected', false],
        ['not_charging', 'Connected', true],
        ['not_charging', 'Not Connected', true],
        ['not_charging', 'Charging', false],
        ['charging_complete', 'Charge Complete', true],
        ['charging_error', 'Error', true],
        ['charging_error', 'Charging', false],
        ['unknown_option', 'Charging', false],
    ])('%s vs %s -> %s', (option, status, expected) => {
        expect(logic.matchesChargingStatus(option, status)).toBe(expected);
    });
});

describe('parseCoordinates', () => {
    test('reads the raw pair from the location capability', () => {
        expect(logic.parseCoordinates('55.570°N, 13.054°E (55.570267,13.053961)'))
            .toEqual({ latitude: 55.570267, longitude: 13.053961 });
    });

    test('reads negative coordinates', () => {
        expect(logic.parseCoordinates('33.869°S, 70.648°W (-33.8688,-70.6483)'))
            .toEqual({ latitude: -33.8688, longitude: -70.6483 });
    });

    test('returns null for Not Available', () => {
        expect(logic.parseCoordinates('Not Available')).toBeNull();
        expect(logic.parseCoordinates(null)).toBeNull();
    });
});

describe('distanceMeters', () => {
    test('is 0 for the same point', () => {
        expect(logic.distanceMeters(55.57, 13.05, 55.57, 13.05)).toBe(0);
    });

    test('is about 111 km per degree of latitude', () => {
        const d = logic.distanceMeters(55, 13, 56, 13);
        expect(d).toBeGreaterThan(111000);
        expect(d).toBeLessThan(111400);
    });
});

describe('geofenceTransition (location trigger)', () => {
    const home = { latitude: 55.570267, longitude: 13.053961, radius: 100 };
    const atHome = { latitude: 55.5703, longitude: 13.0540 };
    const away = { latitude: 55.60, longitude: 13.00 };

    test('enters: fires when the car moves from outside to inside', () => {
        expect(logic.geofenceTransition(away, atHome, home, 'enters')).toBe(true);
    });

    test('enters: does not fire while the car stays inside', () => {
        expect(logic.geofenceTransition(atHome, atHome, home, 'enters')).toBe(false);
    });

    test('enters: does not fire for movement elsewhere', () => {
        expect(logic.geofenceTransition(away, { latitude: 55.61, longitude: 13.0 }, home, 'enters')).toBe(false);
    });

    test('exits: fires when the car moves from inside to outside', () => {
        expect(logic.geofenceTransition(atHome, away, home, 'exits')).toBe(true);
    });

    test('exits: does not fire when the car arrives', () => {
        expect(logic.geofenceTransition(away, atHome, home, 'exits')).toBe(false);
    });

    test('does not fire without a previous or new position', () => {
        expect(logic.geofenceTransition(null, atHome, home, 'enters')).toBe(false);
        expect(logic.geofenceTransition(atHome, null, home, 'exits')).toBe(false);
    });
});

describe('predictChargingMinutes', () => {
    test('uses charge power in W, battery capacity and the charge limit', () => {
        // 20% of 67.8 kWh = 13.56 kWh at 11 kW -> 74 minutes
        expect(logic.predictChargingMinutes({
            batteryLevel: 60, chargeLimit: 80, capacityKwh: 67.8, powerW: 11000,
        })).toBe(74);
    });

    test('returns 0 when not charging', () => {
        expect(logic.predictChargingMinutes({ batteryLevel: 60, chargeLimit: 80, capacityKwh: 67.8, powerW: 0 })).toBe(0);
        expect(logic.predictChargingMinutes({ batteryLevel: 60, chargeLimit: 80, capacityKwh: 67.8, powerW: null })).toBe(0);
    });

    test('returns 0 when already at the limit', () => {
        expect(logic.predictChargingMinutes({ batteryLevel: 80, chargeLimit: 80, capacityKwh: 67.8, powerW: 11000 })).toBe(0);
    });

    test('defaults the limit to 100% when unknown', () => {
        expect(logic.predictChargingMinutes({ batteryLevel: 90, chargeLimit: null, capacityKwh: 60, powerW: 6000 })).toBe(60);
    });

    test('never returns NaN', () => {
        expect(logic.predictChargingMinutes({})).toBe(0);
    });
});

describe('range efficiency', () => {
    test('updateEfficiency starts from the first sample', () => {
        expect(logic.updateEfficiency(null, { batteryLevel: 50, range: 200 })).toBeCloseTo(4);
    });

    test('updateEfficiency smooths new samples', () => {
        const next = logic.updateEfficiency(4, { batteryLevel: 50, range: 250 });
        expect(next).toBeGreaterThan(4);
        expect(next).toBeLessThan(5);
    });

    test('updateEfficiency ignores samples at very low battery or without range', () => {
        expect(logic.updateEfficiency(4, { batteryLevel: 3, range: 20 })).toBe(4);
        expect(logic.updateEfficiency(4, { batteryLevel: 50, range: null })).toBe(4);
        expect(logic.updateEfficiency(null, { batteryLevel: 0, range: 0 })).toBeNull();
    });

    test('predictRangeAtLimit uses the learned km per % and the charge limit', () => {
        expect(logic.predictRangeAtLimit({ efficiency: 4.6, chargeLimit: 80, batteryLevel: 59, range: 274 })).toBe(368);
    });

    test('predictRangeAtLimit falls back to the current ratio without history', () => {
        expect(logic.predictRangeAtLimit({ efficiency: null, chargeLimit: 100, batteryLevel: 50, range: 200 })).toBe(400);
    });

    test('predictRangeAtLimit returns the current range when nothing else is known', () => {
        expect(logic.predictRangeAtLimit({ efficiency: null, chargeLimit: 100, batteryLevel: 0, range: 0 })).toBe(0);
        expect(logic.predictRangeAtLimit({})).toBe(0);
    });
});
