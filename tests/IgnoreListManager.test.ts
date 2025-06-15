// Mock DatabaseManager at the top
const mockQuery = jest.fn();
jest.mock('../src/utils/DatabaseManager', () => ({
    __esModule: true, // This is important for modules mocked with jest.mock
    query: mockQuery,
    getPool: jest.fn(() => ({ // Mock getPool if it's called, e.g. in script finalizers
        end: jest.fn(),
    })),
}));

import { IgnoreListManager } from '../src/managers/IgnoreListManager';

describe('IgnoreListManager (PostgreSQL)', () => {
    let manager: IgnoreListManager;

    beforeEach(() => {
        mockQuery.mockClear(); // Clear mock usage counts and reset implementations between tests
        manager = new IgnoreListManager();
        // Note: loadIgnoreList is not called automatically in constructor anymore.
        // Tests needing a pre-populated list must call it and set up mockQuery accordingly.
    });

    describe('loadIgnoreList', () => {
        it('should load user_ids from the database into the in-memory ignore list', async () => {
            const mockUsers = [{ user_id: 'testuser1' }, { user_id: 'testuser2' }];
            mockQuery.mockResolvedValueOnce({ rows: mockUsers, rowCount: mockUsers.length });

            await manager.loadIgnoreList();

            expect(mockQuery).toHaveBeenCalledWith('SELECT user_id FROM ignore_list;');
            expect(manager.isUserIgnored('testuser1')).toBe(true);
            expect(manager.isUserIgnored('testuser2')).toBe(true);
            expect(manager.isUserIgnored('testuser3')).toBe(false); // Should not be in the list
        });

        it('should handle an empty ignore list from the database', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

            await manager.loadIgnoreList();

            expect(mockQuery).toHaveBeenCalledWith('SELECT user_id FROM ignore_list;');
            expect(manager.isUserIgnored('anyuser')).toBe(false);
        });

        it('should handle database errors during load by initializing an empty list', async () => {
            mockQuery.mockRejectedValueOnce(new Error('Database connection failed'));

            // Suppress console.error for this specific test if manager logs the error
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            await manager.loadIgnoreList();

            expect(mockQuery).toHaveBeenCalledWith('SELECT user_id FROM ignore_list;');
            // Check that the list is empty after an error
            expect(manager.isUserIgnored('anyuser')).toBe(false);
            expect(consoleErrorSpy).toHaveBeenCalled(); // Verify error was logged

            consoleErrorSpy.mockRestore(); // Restore original console.error
        });
    });

    describe('addToIgnoreList', () => {
        it('should add a user to the database and the in-memory list if not already present', async () => {
            // Assume list is empty initially for this test or loaded as empty
            mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // For initial load if any test setup implies it
            // await manager.loadIgnoreList(); // If we want to ensure it starts empty based on DB

            mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // For the INSERT operation

            await manager.addToIgnoreList('newuser');

            expect(mockQuery).toHaveBeenCalledWith(
                'INSERT INTO ignore_list (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING;',
                ['newuser']
            );
            expect(manager.isUserIgnored('newuser')).toBe(true);
        });

        it('should handle adding a user that already exists in the in-memory list (should not query DB)', async () => {
            // Pre-populate in-memory list
            mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'existinguser' }], rowCount: 1 });
            await manager.loadIgnoreList();

            mockQuery.mockClear(); // Clear calls from loadIgnoreList

            await manager.addToIgnoreList('existinguser');

            // Database query should NOT have been called again for INSERT
            expect(mockQuery).not.toHaveBeenCalledWith(
                expect.stringContaining('INSERT'), // Check that no INSERT query was made
                expect.anything()
            );
            expect(manager.isUserIgnored('existinguser')).toBe(true);
        });

        it('should handle database errors during add gracefully', async () => {
            mockQuery.mockRejectedValueOnce(new Error('DB INSERT failed'));
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            await manager.addToIgnoreList('anotheruser');

            // User should NOT be in the in-memory list if DB operation failed
            // (Depends on implementation: current one adds to memory optimistically, then logs error)
            // For stricter test, if DB fails, memory should not be updated or should be reverted.
            // Current manager implementation adds to memory then tries DB.
            expect(manager.isUserIgnored('anotheruser')).toBe(true); // Based on current optimistic update
            expect(consoleErrorSpy).toHaveBeenCalled();

            consoleErrorSpy.mockRestore();
        });
    });

    describe('removeFromIgnoreList', () => {
        beforeEach(async () => {
            // Pre-load the list for removal tests
            mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'user1' }, { user_id: 'user2' }], rowCount: 2 });
            await manager.loadIgnoreList();
            mockQuery.mockClear(); // Clear calls from loadIgnoreList
        });

        it('should remove an existing user from the database and in-memory list', async () => {
            mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // For DELETE operation

            await manager.removeFromIgnoreList('user1');

            expect(mockQuery).toHaveBeenCalledWith(
                'DELETE FROM ignore_list WHERE user_id = $1;',
                ['user1']
            );
            expect(manager.isUserIgnored('user1')).toBe(false);
            expect(manager.isUserIgnored('user2')).toBe(true); // Ensure other user is still there
        });

        it('should do nothing if trying to remove a user not in the in-memory list', async () => {
            await manager.removeFromIgnoreList('nonexistentuser');

            // DELETE query should not have been called
            expect(mockQuery).not.toHaveBeenCalled();
            expect(manager.isUserIgnored('user1')).toBe(true); // Existing users still there
        });

        it('should handle case where user is in memory but not found in DB (consistency adjustment)', async () => {
            mockQuery.mockResolvedValueOnce({ rowCount: 0 }); // Simulate user not found in DB
            const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

            await manager.removeFromIgnoreList('user1'); // user1 is in memory

            expect(mockQuery).toHaveBeenCalledWith('DELETE FROM ignore_list WHERE user_id = $1;', ['user1']);
            expect(manager.isUserIgnored('user1')).toBe(false); // Should be removed from memory for consistency
            expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('not found in database ignore list or already removed'));

            consoleLogSpy.mockRestore();
        });

        it('should handle database errors during remove gracefully', async () => {
            mockQuery.mockRejectedValueOnce(new Error('DB DELETE failed'));
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            await manager.removeFromIgnoreList('user1');

            // User should ideally remain in the in-memory list if DB operation failed
            // (Depends on implementation, current one does not revert optimistic memory change on error)
            expect(manager.isUserIgnored('user1')).toBe(true); // Check if it's still there (or not, based on chosen strategy)
            expect(consoleErrorSpy).toHaveBeenCalled();

            consoleErrorSpy.mockRestore();
        });
    });

    describe('isUserIgnored', () => {
        it('should correctly report if a user is ignored (case-insensitive)', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [{ user_id: 'sensitivecase' }], rowCount: 1 });
            await manager.loadIgnoreList();

            expect(manager.isUserIgnored('sensitivecase')).toBe(true);
            expect(manager.isUserIgnored('SensitiveCase')).toBe(true);
            expect(manager.isUserIgnored('SENSITIVECASE')).toBe(true);
        });

        it('should return false for users not on the list', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // Empty list
            await manager.loadIgnoreList();
            expect(manager.isUserIgnored('someone')).toBe(false);
        });
    });
});
