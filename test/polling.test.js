const { shouldUseRefreshHint, nextPollDelayMs } = require('../lib/polling');

const MIN = 60 * 1000;
const NOW = 1_800_000_000_000;

describe('shouldUseRefreshHint', () => {
    const recent = NOW - 5 * MIN;

    test.each(['Not Connected', 'Connected', 'Charge Complete', 'Error'])(
        'does not wake the car when status is %s and data is recent',
        (chargingStatus) => {
            expect(shouldUseRefreshHint({
                chargingStatus, pluggedIn: false, wasPluggedIn: false, lastDataUpdate: recent, now: NOW,
            })).toBe(false);
        },
    );

    test('wakes the car while it is charging', () => {
        expect(shouldUseRefreshHint({
            chargingStatus: 'Charging', pluggedIn: true, wasPluggedIn: true, lastDataUpdate: recent, now: NOW,
        })).toBe(true);
    });


    test('wakes the car when there is no previous data', () => {
        expect(shouldUseRefreshHint({
            chargingStatus: null, pluggedIn: null, wasPluggedIn: null, lastDataUpdate: null, now: NOW,
        })).toBe(true);
    });

    test('wakes the car when data is older than 30 minutes', () => {
        expect(shouldUseRefreshHint({
            chargingStatus: 'Connected', pluggedIn: true, wasPluggedIn: true, lastDataUpdate: NOW - 31 * MIN, now: NOW,
        })).toBe(true);
    });
});

describe('nextPollDelayMs', () => {
    test('uses the configured interval when not charging', () => {
        expect(nextPollDelayMs({ intervalMinutes: 10, charging: false })).toBe(10 * MIN);
        expect(nextPollDelayMs({ intervalMinutes: 60, charging: false })).toBe(60 * MIN);
    });

    test('polls faster than the idle interval while charging', () => {
        expect(nextPollDelayMs({ intervalMinutes: 10, charging: true })).toBe(5 * MIN);
        expect(nextPollDelayMs({ intervalMinutes: 60, charging: true })).toBe(5 * MIN);
    });

    test('never polls more often than every 10 minutes when idle', () => {
        expect(nextPollDelayMs({ intervalMinutes: 2, charging: false })).toBe(10 * MIN);
        expect(nextPollDelayMs({ intervalMinutes: NaN, charging: false })).toBe(10 * MIN);
    });
});
