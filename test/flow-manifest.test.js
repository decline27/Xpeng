const path = require('path');
const { matchesChargingStatus } = require('../lib/flow-logic');

const flowDir = path.join(__dirname, '..', '.homeycompose', 'flow');
const card = (type, id) => require(path.join(flowDir, type, `${id}.json`));
const REACHABLE_STATUSES = ['Charging', 'Connected', 'Not Connected', 'Charge Complete', 'Error'];

describe('flow card definitions', () => {
    test.each([
        ['conditions', 'charging_status'],
        ['triggers', 'charging_status_changed'],
    ])('every %s/%s status option can actually match', (type, id) => {
        const options = card(type, id).args.find((a) => a.name === 'status').values.map((v) => v.id);
        for (const option of options) {
            const reachable = REACHABLE_STATUSES.some((status) => matchesChargingStatus(option, status));
            expect({ option, reachable }).toEqual({ option, reachable: true });
        }
    });

    test('charging_status_changed declares the tokens the device sends', () => {
        const tokens = card('triggers', 'charging_status_changed').tokens.map((t) => t.name);
        expect(tokens).toEqual(['previous_status', 'current_status']);
    });

    test('charging_status_changed token examples use real status values', () => {
        const examples = card('triggers', 'charging_status_changed').tokens.map((t) => t.example);
        examples.forEach((example) => expect(REACHABLE_STATUSES).toContain(example));
    });

    test('location_changed declares only the distance token, described as distance moved', () => {
        const { tokens } = card('triggers', 'location_changed');
        expect(tokens.map((t) => t.name)).toEqual(['distance']);
        expect(tokens[0].title.en).toMatch(/moved/i);
    });

    test('location_changed is described as entering or leaving an area', () => {
        const { title, titleFormatted } = card('triggers', 'location_changed');
        expect(title.en).toMatch(/enters or leaves/i);
        expect(titleFormatted.en).toContain('[[comparison]]');
    });

    test('predict_range explains that it predicts range at the charge limit', () => {
        const action = card('actions', 'predict_range');
        expect(action.hint.en).toMatch(/charge limit/i);
    });

    test.each(['battery_low', 'range_low'])('%s is described as firing once per drop', (id) => {
        expect(card('triggers', id).hint.en).toMatch(/once/i);
    });
});
