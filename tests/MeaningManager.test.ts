const mockQuery = jest.fn();
jest.mock('../src/utils/DatabaseManager', () => ({
    __esModule: true,
    query: mockQuery,
    getPool: jest.fn(() => ({ end: jest.fn() })),
}));

import { MeaningManager } from '../src/managers/MeaningManager';

describe('MeaningManager', () => {
    let manager: MeaningManager;

    beforeEach(() => {
        mockQuery.mockClear();
        manager = new MeaningManager();
    });

    describe('loadMeanings', () => {
        it('should load meanings from DB and populate the map', async () => {
            const dbRows = [
                { user_id: 'user1', meaning: 'Meaning One' },
                { user_id: 'USER2', meaning: 'Meaning Two' }, // Test case handling
            ];
            mockQuery.mockResolvedValueOnce({ rows: dbRows, rowCount: dbRows.length });

            await manager.loadMeanings();

            expect(mockQuery).toHaveBeenCalledWith('SELECT user_id, meaning FROM user_meanings;');
            expect(manager.getUserMeaning('user1')).toBe('Meaning One');
            expect(manager.getUserMeaning('user2')).toBe('Meaning Two'); // Manager uses .toLowerCase() for keys
            expect(manager.getUserMeaning('nonexistentuser')).toBe('nonexistentuser'); // Default behavior
        });

        it('should handle empty results from the database', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
            await manager.loadMeanings();
            expect(manager.getUserMeaning('anyuser')).toBe('anyuser');
        });

        it('should handle database errors during load gracefully', async () => {
            mockQuery.mockRejectedValueOnce(new Error('DB Load Error'));
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            await manager.loadMeanings();

            expect(manager.getUserMeaning('anyuser')).toBe('anyuser'); // Map should be empty
            expect(consoleErrorSpy).toHaveBeenCalledWith('Error loading user meanings from database:', expect.any(Error));
            consoleErrorSpy.mockRestore();
        });
    });

    describe('setMeaning', () => {
        it('should set a meaning in DB and update in-memory map', async () => {
            mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // For INSERT/UPDATE

            await manager.setMeaning('NewUser', 'This is their meaning');

            expect(mockQuery).toHaveBeenCalledWith(
                'INSERT INTO user_meanings (user_id, meaning) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET meaning = EXCLUDED.meaning, updated_at = CURRENT_TIMESTAMP;',
                ['newuser', 'This is their meaning']
            );
            expect(manager.getUserMeaning('newuser')).toBe('This is their meaning');
        });

        it('should update an existing meaning', async () => {
            // Preload
            mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'user1', meaning: 'Old Meaning' }], rowCount: 1});
            await manager.loadMeanings();
            mockQuery.mockClear();

            mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // For the UPDATE
            await manager.setMeaning('user1', 'Updated Meaning');
             expect(mockQuery).toHaveBeenCalledWith(
                'INSERT INTO user_meanings (user_id, meaning) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET meaning = EXCLUDED.meaning, updated_at = CURRENT_TIMESTAMP;',
                ['user1', 'Updated Meaning']
            );
            expect(manager.getUserMeaning('user1')).toBe('Updated Meaning');
        });

        it('should handle DB error during setMeaning', async () => {
            mockQuery.mockRejectedValueOnce(new Error('DB Insert/Update Error'));
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            await manager.setMeaning('ErrorUser', 'Error Meaning');

            // Current implementation optimistically updates map then logs error
            expect(manager.getUserMeaning('erroruser')).toBe('Error Meaning');
            expect(consoleErrorSpy).toHaveBeenCalled();
            consoleErrorSpy.mockRestore();
        });
    });

    describe('removeMeaning', () => {
        beforeEach(async () => {
            const dbRows = [{ user_id: 'usertoremove', meaning: 'A meaning to remove' }];
            mockQuery.mockResolvedValueOnce({ rows: dbRows, rowCount: dbRows.length });
            await manager.loadMeanings();
            mockQuery.mockClear();
        });

        it('should remove a meaning from DB and update map', async () => {
            mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // For DELETE
            const result = await manager.removeMeaning('usertoremove');

            expect(result).toBe(true);
            expect(mockQuery).toHaveBeenCalledWith(
                'DELETE FROM user_meanings WHERE user_id = $1;',
                ['usertoremove']
            );
            expect(manager.getUserMeaning('usertoremove')).toBe('usertoremove'); // Returns key if not found
        });

        it('should return false and not query DB if user not in memory', async () => {
            const result = await manager.removeMeaning('nonexistentuser');
            expect(result).toBe(false);
            expect(mockQuery).not.toHaveBeenCalled();
        });

        it('should handle user in memory but not in DB (rowCount 0 from DELETE)', async () => {
            mockQuery.mockResolvedValueOnce({ rowCount: 0 }); // Simulate not found in DB
            const result = await manager.removeMeaning('usertoremove'); // 'usertoremove' is in memory

            expect(result).toBe(false); // Manager's removeMeaning returns based on rowCount
            expect(manager.getUserMeaning('usertoremove')).toBe('usertoremove'); // Should be removed from memory for consistency
        });
    });

    describe('getUserMeaning', () => {
        it('should be case-insensitive for user keys', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'testuser', meaning: 'Test Meaning' }], rowCount: 1 });
            await manager.loadMeanings();
            expect(manager.getUserMeaning('TestUser')).toBe('Test Meaning');
            expect(manager.getUserMeaning('TESTUSER')).toBe('Test Meaning');
        });
    });
});
