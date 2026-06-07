const DuplicateReaper = require('../lib/duplicate-reaper');

function vehicle(id, userId, vin, lastSeen) {
    return { id, userId, lastSeen, information: { vin } };
}

function makeApi(clientVehicles, disconnectUser) {
    return {
        clientManager: {
            getAllClients: () => Object.keys(clientVehicles).map((id) => ({ id })),
        },
        _getVehiclesForClient: async (id) => clientVehicles[id] || [],
        disconnectUser: disconnectUser || jest.fn().mockResolvedValue(true),
    };
}

describe('duplicate-reaper', () => {
    describe('analyzeDuplicates', () => {
        test('marks the older copy of a VIN as safe to disconnect', async () => {
            const api = makeApi({
                clientA: [vehicle('v1', 'uOld', 'VIN1', '2020-01-01T00:00:00Z')],
                clientB: [vehicle('v2', 'uNew', 'VIN1', '2026-01-01T00:00:00Z')],
            });

            const res = await DuplicateReaper.analyzeDuplicates(api);

            expect(res.dupVins).toBe(1);
            expect(res.staleCount).toBe(1);
            expect(res.safe).toEqual([
                { userId: 'uOld', clientId: 'clientA', vins: ['VIN1'] },
            ]);
            expect(res.risky).toEqual([]);
        });

        test('spares a user who also owns a kept/live car (risky, not safe)', async () => {
            const api = makeApi({
                // uX owns a stale copy of VIN1 AND the only (kept) copy of VIN2
                clientA: [
                    vehicle('v1', 'uX', 'VIN1', '2020-01-01T00:00:00Z'),
                    vehicle('v3', 'uX', 'VIN2', '2026-01-01T00:00:00Z'),
                ],
                clientB: [vehicle('v2', 'uNew', 'VIN1', '2026-06-01T00:00:00Z')],
            });

            const res = await DuplicateReaper.analyzeDuplicates(api);

            expect(res.safe).toEqual([]); // uX must NOT be auto-disconnected
            expect(res.risky).toEqual([
                { userId: 'uX', clientId: 'clientA', vins: ['VIN1'] },
            ]);
        });

        test('no duplicates → nothing safe or risky', async () => {
            const api = makeApi({
                clientA: [vehicle('v1', 'uA', 'VIN1', '2026-01-01T00:00:00Z')],
                clientB: [vehicle('v2', 'uB', 'VIN2', '2026-01-01T00:00:00Z')],
            });

            const res = await DuplicateReaper.analyzeDuplicates(api);

            expect(res.dupVins).toBe(0);
            expect(res.safe).toEqual([]);
            expect(res.risky).toEqual([]);
        });
    });

    describe('reapForVin', () => {
        test('log-only mode lists targets but disconnects nothing', async () => {
            const disconnectUser = jest.fn().mockResolvedValue(true);
            const api = makeApi({
                clientA: [vehicle('v1', 'uOld', 'VIN1', '2020-01-01T00:00:00Z')],
                clientB: [vehicle('v2', 'uNew', 'VIN1', '2026-01-01T00:00:00Z')],
            }, disconnectUser);

            const res = await DuplicateReaper.reapForVin(api, 'VIN1', { execute: false });

            expect(res.targets).toHaveLength(1);
            expect(res.disconnected).toBe(0);
            expect(res.executed).toBe(false);
            expect(disconnectUser).not.toHaveBeenCalled();
        });

        test('execute mode disconnects exactly the safe stale copy', async () => {
            const disconnectUser = jest.fn().mockResolvedValue(true);
            const api = makeApi({
                clientA: [vehicle('v1', 'uOld', 'VIN1', '2020-01-01T00:00:00Z')],
                clientB: [vehicle('v2', 'uNew', 'VIN1', '2026-01-01T00:00:00Z')],
            }, disconnectUser);

            const res = await DuplicateReaper.reapForVin(api, 'VIN1', { execute: true });

            expect(res.disconnected).toBe(1);
            expect(res.executed).toBe(true);
            expect(disconnectUser).toHaveBeenCalledTimes(1);
            expect(disconnectUser).toHaveBeenCalledWith('uOld', 'clientA');
        });

        test('does not touch a VIN with no duplicates', async () => {
            const disconnectUser = jest.fn().mockResolvedValue(true);
            const api = makeApi({
                clientA: [vehicle('v1', 'uA', 'VIN1', '2026-01-01T00:00:00Z')],
            }, disconnectUser);

            const res = await DuplicateReaper.reapForVin(api, 'VIN1', { execute: true });

            expect(res.targets).toHaveLength(0);
            expect(disconnectUser).not.toHaveBeenCalled();
        });
    });
});
