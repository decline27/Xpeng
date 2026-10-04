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

        test('same user, same VIN on two clients → stale copy is safe (per-client delete)', async () => {
            // Enode namespaces users per client, and disconnectUser(userId, clientId) deletes only
            // that client's copy. A returning user whose car got re-linked onto a second client owns
            // a stale copy on clientA and the live copy on clientB — deleting the clientA copy cannot
            // harm the clientB copy, so it must be classified SAFE, not risky.
            const api = makeApi({
                clientA: [vehicle('v1', 'uSame', 'VIN1', '2020-01-01T00:00:00Z')],
                clientB: [vehicle('v2', 'uSame', 'VIN1', '2026-01-01T00:00:00Z')],
            });

            const res = await DuplicateReaper.analyzeDuplicates(api);

            expect(res.dupVins).toBe(1);
            expect(res.staleCount).toBe(1);
            expect(res.safe).toEqual([
                { userId: 'uSame', clientId: 'clientA', vins: ['VIN1'] },
            ]);
            expect(res.risky).toEqual([]);
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

            const res = await DuplicateReaper.reapForVin(api, 'VIN1', { execute: false, ownerUserIds: ['uOld', 'uNew'] });

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

            const res = await DuplicateReaper.reapForVin(api, 'VIN1', { execute: true, ownerUserIds: ['uOld', 'uNew'] });

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

        test('never disconnects another household\'s link to the same car', async () => {
            // Two Homeys linked to one car: this Homey owns uMine, someone else owns uOther.
            const disconnectUser = jest.fn().mockResolvedValue(true);
            const api = makeApi({
                clientA: [vehicle('v1', 'uOther', 'VIN1', '2020-01-01T00:00:00Z')],
                clientB: [vehicle('v2', 'uMine', 'VIN1', '2026-01-01T00:00:00Z')],
            }, disconnectUser);

            const res = await DuplicateReaper.reapForVin(api, 'VIN1', { execute: true, ownerUserIds: ['uMine'] });

            expect(res.targets).toHaveLength(0);
            expect(disconnectUser).not.toHaveBeenCalled();
        });

        test('does nothing when the owner user ids are not given', async () => {
            const disconnectUser = jest.fn().mockResolvedValue(true);
            const api = makeApi({
                clientA: [vehicle('v1', 'uOld', 'VIN1', '2020-01-01T00:00:00Z')],
                clientB: [vehicle('v2', 'uNew', 'VIN1', '2026-01-01T00:00:00Z')],
            }, disconnectUser);

            const res = await DuplicateReaper.reapForVin(api, 'VIN1', { execute: true });

            expect(res.targets).toHaveLength(0);
            expect(disconnectUser).not.toHaveBeenCalled();
        });

        test('keeps the freshly linked copy even when Enode has no lastSeen for it yet', async () => {
            // The new link (v2, legacy-id user uLegacy -> stable uStable) has lastSeen null right
            // after linking; the old copy was seen recently. The new link must survive.
            const disconnectUser = jest.fn().mockResolvedValue(true);
            const api = makeApi({
                clientA: [vehicle('v1', 'uLegacy', 'VIN1', '2026-10-01T00:00:00Z')],
                clientB: [vehicle('v2', 'uStable', 'VIN1', null)],
            }, disconnectUser);

            const res = await DuplicateReaper.reapForVin(api, 'VIN1', {
                execute: true,
                ownerUserIds: ['uLegacy', 'uStable'],
                keepVehicleId: 'v2',
            });

            expect(disconnectUser).toHaveBeenCalledTimes(1);
            expect(disconnectUser).toHaveBeenCalledWith('uLegacy', 'clientA');
            expect(res.targets).toEqual([{ userId: 'uLegacy', clientId: 'clientA', vins: ['VIN1'] }]);
        });
    });
});
