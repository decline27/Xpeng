const { resolveUserId, getLegacyUserId, getUserIdCandidates, STABLE_ID_KEY } = require('../lib/user-identity');

function makeHomey({ settings = {}, getHomeyId } = {}) {
    const store = { ...settings };
    return {
        id: undefined, // mirrors the real SDK: `homey.id` does not exist
        settings: {
            get: (k) => (k in store ? store[k] : null),
            set: (k, v) => { store[k] = v; },
        },
        cloud: getHomeyId ? { getHomeyId } : undefined,
        _store: store,
    };
}

describe('user-identity', () => {
    describe('resolveUserId', () => {
        test('derives id from Homey Cloud id and caches it', async () => {
            const getHomeyId = jest.fn().mockResolvedValue('abc123');
            const homey = makeHomey({ getHomeyId });

            const id = await resolveUserId(homey);

            expect(id).toBe('homey-abc123');
            expect(homey._store[STABLE_ID_KEY]).toBe('abc123');
            expect(getHomeyId).toHaveBeenCalledTimes(1);
        });

        test('reuses cached stable id without calling getHomeyId again', async () => {
            const getHomeyId = jest.fn().mockResolvedValue('zzz');
            const homey = makeHomey({ settings: { [STABLE_ID_KEY]: 'cached1' }, getHomeyId });

            const id = await resolveUserId(homey);

            expect(id).toBe('homey-cached1');
            expect(getHomeyId).not.toHaveBeenCalled();
        });

        test('falls back to installation_id when cloud id unavailable', async () => {
            const getHomeyId = jest.fn().mockRejectedValue(new Error('offline'));
            const homey = makeHomey({ settings: { installation_id: 'legacyabc' }, getHomeyId });

            const id = await resolveUserId(homey);

            expect(id).toBe('homey-legacyabc');
            // and it persists so the id stays consistent next time
            expect(homey._store[STABLE_ID_KEY]).toBe('legacyabc');
        });
    });

    describe('getLegacyUserId', () => {
        test('builds homey-homey-<installationId> (mirrors the old broken scheme)', () => {
            const homey = makeHomey({ settings: { installation_id: 'inst9' } });
            expect(getLegacyUserId(homey)).toBe('homey-homey-inst9');
        });

        test('returns null when no installation id stored', () => {
            const homey = makeHomey();
            expect(getLegacyUserId(homey)).toBeNull();
        });
    });

    describe('getUserIdCandidates', () => {
        test('returns both stable and legacy ids during migration', async () => {
            const getHomeyId = jest.fn().mockResolvedValue('stable9');
            const homey = makeHomey({ settings: { installation_id: 'inst9' }, getHomeyId });

            const candidates = await getUserIdCandidates(homey);

            expect(candidates).toContain('homey-stable9');
            expect(candidates).toContain('homey-homey-inst9');
            expect(candidates).toHaveLength(2);
        });
    });
});
