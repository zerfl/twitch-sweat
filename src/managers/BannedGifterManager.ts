import { query } from '../utils/DatabaseManager'; // Adjust path as needed

export class BannedGifterManager {
    private readonly bannedGiftersSet: Set<string> = new Set();

    constructor() {
        // Set is initialized empty and populated by loadBannedGifters
    }

    async loadBannedGifters(): Promise<void> {
        this.bannedGiftersSet.clear(); // Clear existing set before loading
        try {
            const result = await query('SELECT gifter_user_id FROM banned_gifters;');
            for (const row of result.rows) {
                this.bannedGiftersSet.add(row.gifter_user_id.toLowerCase());
            }
            console.log(`Banned gifters loaded from database into global set. Count: ${this.bannedGiftersSet.size}`);
        } catch (error) {
            console.error('Error loading banned gifters from database:', error);
            // In case of error, the set remains empty or partially filled.
        }
    }

    async addBannedGifter(gifter: string): Promise<void> {
        const lowerGifter = gifter.toLowerCase();

        if (this.bannedGiftersSet.has(lowerGifter)) {
            console.log(`Gifter ${lowerGifter} is already in the in-memory banned list.`);
            return; // Already in memory
        }

        try {
            // The table schema ensures gifter_user_id is PRIMARY KEY, so ON CONFLICT handles duplicates.
            const result = await query(
                'INSERT INTO banned_gifters (gifter_user_id) VALUES ($1) ON CONFLICT (gifter_user_id) DO NOTHING;',
                [lowerGifter]
            );

            this.bannedGiftersSet.add(lowerGifter); // Update in-memory set

            if (result.rowCount > 0) {
                console.log(`Gifter ${lowerGifter} added to the global banned list in database.`);
            } else {
                // This means there was a conflict, but the user wasn't in the in-memory set.
                // This could happen if another instance added it, or if load failed previously.
                // Ensure in-memory is consistent.
                console.log(`Gifter ${lowerGifter} was already present in the database or add failed (conflict). Ensured in-memory consistency.`);
            }
        } catch (error) {
            console.error(`Error adding banned gifter ${lowerGifter} to database:`, error);
            // If DB operation fails, consider if the optimistic add to in-memory set should be reverted.
            // For now, it remains in memory if added before error.
        }
    }

    async removeBannedGifter(gifter: string): Promise<boolean> {
        const lowerGifter = gifter.toLowerCase();

        if (!this.bannedGiftersSet.has(lowerGifter)) {
            console.log(`Gifter ${lowerGifter} is not in the in-memory banned list.`);
            return false; // Not in memory
        }

        try {
            const result = await query(
                'DELETE FROM banned_gifters WHERE gifter_user_id = $1;',
                [lowerGifter]
            );

            if (result.rowCount > 0) {
                this.bannedGiftersSet.delete(lowerGifter); // Update in-memory set
                console.log(`Gifter ${lowerGifter} removed from the global banned list in database.`);
                return true;
            } else {
                // If rowCount is 0, it means the entry wasn't in the DB,
                // which is inconsistent with it being in memory.
                // For consistency, remove from memory too.
                this.bannedGiftersSet.delete(lowerGifter);
                console.log(`Gifter ${lowerGifter} not found in DB for deletion, but removed from memory to ensure consistency.`);
                return false;
            }
        } catch (error) {
            console.error(`Error removing banned gifter ${lowerGifter} from database:`, error);
            // If DB operation fails, we might not want to update the in-memory set.
            return false;
        }
    }

    isGifterBanned(gifter: string): boolean {
        return this.bannedGiftersSet.has(gifter.toLowerCase());
    }

    // Optional: Method to get a copy of all banned gifters if needed by other parts of the application
    public getBannedGiftersList(): string[] {
        return Array.from(this.bannedGiftersSet);
    }
}