import { query } from '../utils/DatabaseManager'; // Adjust path as needed

export class IgnoreListManager {
    private ignoreList: Set<string>;

    constructor() { // filePath is removed
        this.ignoreList = new Set();
        // No need to read file here, loadIgnoreList will be called explicitly during app initialization
    }

    public async loadIgnoreList(): Promise<void> {
        try {
            const result = await query('SELECT user_id FROM ignore_list;');
            const users = result.rows.map(row => row.user_id);
            this.ignoreList = new Set(users);
            console.log('Ignore list loaded from database.');
        } catch (error) {
            console.error('Error loading ignore list from database:', error);
            // Operating with an empty list if DB load fails.
            // Consider more sophisticated error handling or retry mechanisms for production.
            this.ignoreList = new Set();
        }
    }

    public async addToIgnoreList(username: string): Promise<void> {
        const lowerUsername = username.toLowerCase();
        if (this.ignoreList.has(lowerUsername)) {
            console.log(`User ${lowerUsername} is already in the in-memory ignore list.`);
            return;
        }
        try {
            // ON CONFLICT (user_id) DO NOTHING ensures that if the user_id already exists,
            // the query completes without error and doesn't insert a duplicate.
            const result = await query('INSERT INTO ignore_list (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING;', [lowerUsername]);
            // Check if a row was actually inserted (or if it was a conflict)
            // For ON CONFLICT DO NOTHING, rowCount might be 0 if there's a conflict.
            // We add to the in-memory set regardless, as the state should reflect the DB.
            // A more accurate way would be to check if it was already in the set.
            // However, our initial check `this.ignoreList.has(lowerUsername)` handles this.
            // So, if we reach here, it means it wasn't in the set.
            this.ignoreList.add(lowerUsername); // Update in-memory set
            if (result.rowCount > 0) {
                console.log(`User ${lowerUsername} added to ignore list in database.`);
            } else {
                console.log(`User ${lowerUsername} was already present in the database ignore list or failed to add (conflict).`);
                // Ensure in-memory is consistent if it somehow wasn't added before
                // This case should ideally be rare due to the initial check.
            }
        } catch (error) {
            console.error(`Error adding user ${lowerUsername} to ignore list in database:`, error);
            // Consider re-throwing or specific error handling.
            // If DB operation fails, we might not want to add to in-memory set,
            // or have a mechanism to sync/reconcile. For now, it's added to memory optimistically if no error.
        }
    }

    public async removeFromIgnoreList(username: string): Promise<void> {
        const lowerUsername = username.toLowerCase();
        if (!this.ignoreList.has(lowerUsername)) {
            console.log(`User ${lowerUsername} is not in the in-memory ignore list.`);
            return;
        }
        try {
            const result = await query('DELETE FROM ignore_list WHERE user_id = $1;', [lowerUsername]);
            if (result.rowCount > 0) {
                this.ignoreList.delete(lowerUsername); // Update in-memory set
                console.log(`User ${lowerUsername} removed from ignore list in database.`);
            } else {
                console.log(`User ${lowerUsername} not found in database ignore list or already removed.`);
                // If not found in DB, but was in memory, remove from memory to ensure consistency.
                this.ignoreList.delete(lowerUsername);
            }
        } catch (error) {
            console.error(`Error removing user ${lowerUsername} from ignore list in database:`, error);
            // Consider re-throwing or specific error handling.
            // If DB operation fails, we might not want to remove from in-memory set.
        }
    }

    public isUserIgnored(username: string): boolean {
        return this.ignoreList.has(username.toLowerCase());
    }
}
