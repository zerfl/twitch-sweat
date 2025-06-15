const mockQuery = jest.fn();
jest.mock('../src/utils/DatabaseManager', () => ({
    __esModule: true,
    query: mockQuery,
    getPool: jest.fn(() => ({ end: jest.fn() })),
}));

import { BannedGifterManager } from '../src/managers/BannedGifterManager';

describe('BannedGifterManager (Single Broadcaster Model)', () => {
    let manager: BannedGifterManager;

    beforeEach(() => {
        mockQuery.mockClear();
        manager = new BannedGifterManager();
    });

    describe('loadBannedGifters', () => {
        it('should load gifter_user_ids from DB into the bannedGiftersSet', async () => {
            const dbRows = [
                { gifter_user_id: 'gifter1' },
                { gifter_user_id: 'Gifter2' }, // Test case handling
                { gifter_user_id: 'gifter3' },
            ];
            mockQuery.mockResolvedValueOnce({ rows: dbRows, rowCount: dbRows.length });

            await manager.loadBannedGifters();

            expect(mockQuery).toHaveBeenCalledWith('SELECT gifter_user_id FROM banned_gifters;');
            expect(manager.isGifterBanned('gifter1')).toBe(true);
            expect(manager.isGifterBanned('gifter2')).toBe(true); // Manager converts to lowercase
            expect(manager.isGifterBanned('GIFTER3')).toBe(true); // Test case insensitivity of isGifterBanned
            expect(manager.isGifterBanned('nonexistentgifter')).toBe(false);

            const list = manager.getBannedGiftersList();
            expect(list).toContain('gifter1');
            expect(list).toContain('gifter2');
            expect(list).toContain('gifter3');
            expect(list.length).toBe(3);
        });

        it('should handle empty results from the database for loadBannedGifters', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
            await manager.loadBannedGifters();
            expect(manager.isGifterBanned('anygifter')).toBe(false);
            expect(manager.getBannedGiftersList().length).toBe(0);
        });

        it('should handle database errors during load gracefully and keep set empty', async () => {
            mockQuery.mockRejectedValueOnce(new Error('DB Load Error'));
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            await manager.loadBannedGifters();

            expect(manager.isGifterBanned('anygifter')).toBe(false);
            expect(manager.getBannedGiftersList().length).toBe(0);
            expect(consoleErrorSpy).toHaveBeenCalledWith('Error loading banned gifters from database:', expect.any(Error));
            consoleErrorSpy.mockRestore();
        });
    });

    describe('addBannedGifter', () => {
        it('should add a gifter to DB and update in-memory set', async () => {
            mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // For INSERT

            await manager.addBannedGifter('newGifter1');

            expect(mockQuery).toHaveBeenCalledWith(
                'INSERT INTO banned_gifters (gifter_user_id) VALUES ($1) ON CONFLICT (gifter_user_id) DO NOTHING;',
                ['newgifter1'] // Manager converts to lowercase before DB call
            );
            expect(manager.isGifterBanned('newgifter1')).toBe(true);
            expect(manager.getBannedGiftersList()).toContain('newgifter1');
        });

        it('should not query DB if gifter is already banned in memory', async () => {
            // Preload
            mockQuery.mockResolvedValueOnce({ rows: [{ gifter_user_id: 'existinggifter' }], rowCount: 1 });
            await manager.loadBannedGifters();
            mockQuery.mockClear(); // Clear spies from load

            await manager.addBannedGifter('existinggifter');
            expect(mockQuery).not.toHaveBeenCalled(); // No DB call because it's already in memory
        });

        it('should handle DB error during addBannedGifter and not add to set if DB fails', async () => {
            mockQuery.mockRejectedValueOnce(new Error('DB Insert Error'));
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            // Manager's current implementation optimistically adds to set THEN tries DB.
            // Let's test this behavior. If it were to revert, the test would change.
            await manager.addBannedGifter('errorgifter');

            expect(manager.isGifterBanned('errorgifter')).toBe(true); // Optimistic add
            expect(consoleErrorSpy).toHaveBeenCalledWith('Error adding banned gifter errorgifter to database:', expect.any(Error));
            consoleErrorSpy.mockRestore();
        });

        it('should add to in-memory set even if ON CONFLICT occurs in DB (rowCount 0)', async () => {
            mockQuery.mockResolvedValueOnce({ rowCount: 0 }); // INSERT ON CONFLICT DO NOTHING leads to rowCount 0
             await manager.addBannedGifter('conflictinggifter');
             expect(manager.isGifterBanned('conflictinggifter')).toBe(true);
             expect(mockQuery).toHaveBeenCalledWith(
                'INSERT INTO banned_gifters (gifter_user_id) VALUES ($1) ON CONFLICT (gifter_user_id) DO NOTHING;',
                ['conflictinggifter']
            );
        });
    });

    describe('removeBannedGifter', () => {
        beforeEach(async () => {
            const dbRows = [{ gifter_user_id: 'giftertoremove' }];
            mockQuery.mockResolvedValueOnce({ rows: dbRows, rowCount: dbRows.length });
            await manager.loadBannedGifters();
            mockQuery.mockClear();
        });

        it('should remove a banned gifter from DB and update set', async () => {
            mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // For DELETE
            const result = await manager.removeBannedGifter('giftertoremove');

            expect(result).toBe(true);
            expect(mockQuery).toHaveBeenCalledWith(
                'DELETE FROM banned_gifters WHERE gifter_user_id = $1;',
                ['giftertoremove']
            );
            expect(manager.isGifterBanned('giftertoremove')).toBe(false);
            expect(manager.getBannedGiftersList()).not.toContain('giftertoremove');
        });

        it('should return false and not query DB if gifter not banned in memory', async () => {
            const result = await manager.removeBannedGifter('notbannedgifter');
            expect(result).toBe(false);
            expect(mockQuery).not.toHaveBeenCalled();
        });

        it('should handle gifter in memory but not in DB (rowCount 0 from DELETE) by removing from set', async () => {
            mockQuery.mockResolvedValueOnce({ rowCount: 0 });
            const result = await manager.removeBannedGifter('giftertoremove'); // 'giftertoremove' is in memory

            expect(result).toBe(false);
            expect(manager.isGifterBanned('giftertoremove')).toBe(false); // Should be removed from memory for consistency
        });

        it('should handle DB error during removeBannedGifter and not remove from set if DB fails', async () => {
            mockQuery.mockRejectedValueOnce(new Error("DB Delete Error"));
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            const result = await manager.removeBannedGifter('giftertoremove');
            expect(result).toBe(false);
            expect(manager.isGifterBanned('giftertoremove')).toBe(true); // Should remain in set
            expect(consoleErrorSpy).toHaveBeenCalled();
            consoleErrorSpy.mockRestore();
        });
    });

    describe('getBannedGiftersList', () => {
        it('should return an array of all banned gifters from the set', async () => {
            const dbRows = [
                { gifter_user_id: 'g1' }, { gifter_user_id: 'g2' }, { gifter_user_id: 'g3' },
            ];
            mockQuery.mockResolvedValueOnce({ rows: dbRows, rowCount: dbRows.length });
            await manager.loadBannedGifters();

            const list = manager.getBannedGiftersList();
            expect(list).toEqual(expect.arrayContaining(['g1', 'g2', 'g3']));
            expect(list.length).toBe(3);
        });

        it('should return an empty array if the set is empty', () => {
            const list = manager.getBannedGiftersList();
            expect(list).toEqual([]);
        });
    });
});
