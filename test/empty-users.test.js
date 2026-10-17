const { findEmptyUsers } = require('../lib/empty-users');

const NOW = Date.parse('2026-10-17T12:00:00Z');
const OLD = '2026-10-01T00:00:00Z';
const RECENT = '2026-10-17T11:00:00Z';

const json = (body) => ({ json: async () => body });

/**
 * Fake EnodeAPI: per client, the users Enode lists, the vehicles it holds, and the
 * linkedVendors GET /users/{id} returns (or an Error to throw).
 */
function makeApi(clients) {
    return {
        apiBaseUrl: 'https://enode.test',
        requestCache: { clear: jest.fn() },
        clientManager: {
            getAllClients: () => Object.keys(clients)
                .map(id => ({ id, enodeClientId: `${id}-id`, enodeClientSecret: clients[id].noSecret ? null : 's' })),
        },
        getAccessToken: jest.fn(async (vehicleId, clientId) => `token-${clientId}`),
        _getVehiclesForClient: jest.fn(async (clientId) => clients[clientId].vehicles || []),
        makeRequest: jest.fn(async (url, options) => {
            const clientId = options.headers.Authorization.replace('Bearer token-', '');
            const client = clients[clientId];
            const userMatch = /\/users\/([^?]+)$/.exec(url);
            if (userMatch) {
                const vendors = client.vendors[decodeURIComponent(userMatch[1])];
                if (vendors instanceof Error) throw vendors;
                return json({ linkedVendors: vendors });
            }
            return json({ data: client.users, pagination: { after: null } });
        }),
    };
}

describe('findEmptyUsers', () => {
    test('reports an old user without a vehicle, and not users that own a car', async () => {
        const api = makeApi({
            primary: {
                users: [{ id: 'with-car', createdAt: OLD }, { id: 'empty', createdAt: OLD }],
                vehicles: [{ id: 'v1', userId: 'with-car' }],
                vendors: { empty: [] },
            },
        });

        const res = await findEmptyUsers(api, { now: NOW });

        expect(res.empty).toEqual([{ userId: 'empty', clientId: 'primary', createdAt: OLD }]);
        expect(res.byClient.primary).toEqual({ users: 2, withCars: 1, empty: 1 });
    });

    test('skips a user created recently, who may be linking right now', async () => {
        const api = makeApi({
            primary: { users: [{ id: 'linking', createdAt: RECENT }], vehicles: [], vendors: { linking: [] } },
        });

        const res = await findEmptyUsers(api, { now: NOW });

        expect(res.empty).toEqual([]);
        expect(res.skippedRecent).toBe(1);
    });

    test('does not report a user Enode says still has a linked vendor', async () => {
        const api = makeApi({
            primary: { users: [{ id: 'u', createdAt: OLD }], vehicles: [], vendors: { u: [{ vendor: 'XPENG' }] } },
        });

        await expect(findEmptyUsers(api, { now: NOW })).resolves.toMatchObject({ empty: [] });
    });

    test('does not report a user it cannot confirm because Enode returned an error', async () => {
        const api = makeApi({
            primary: { users: [{ id: 'u', createdAt: OLD }], vehicles: [], vendors: { u: new Error('503') } },
        });

        await expect(findEmptyUsers(api, { now: NOW })).resolves.toMatchObject({ empty: [] });
    });

    test('judges the same user id separately on each client', async () => {
        const api = makeApi({
            primary: { users: [{ id: 'same', createdAt: OLD }], vehicles: [], vendors: { same: [] } },
            client_7: {
                users: [{ id: 'same', createdAt: OLD }],
                vehicles: [{ id: 'v', userId: 'same' }],
                vendors: { same: [{ vendor: 'XPENG' }] },
            },
        });

        const res = await findEmptyUsers(api, { now: NOW });

        expect(res.empty).toEqual([{ userId: 'same', clientId: 'primary', createdAt: OLD }]);
    });

    test('skips clients without credentials', async () => {
        const api = makeApi({
            removed: { noSecret: true, users: [], vehicles: [], vendors: {} },
            primary: { users: [], vehicles: [], vendors: {} },
        });

        await findEmptyUsers(api, { now: NOW });

        expect(api._getVehiclesForClient).not.toHaveBeenCalledWith('removed');
    });
});
