import { query } from '../utils/DatabaseManager'; // Adjust path as needed

type UserMeaningMap = Map<string, string>;

export class MeaningManager {
    private readonly userMeaningMap: UserMeaningMap = new Map();

    constructor() { // filePath parameter removed
        // userMeaningMap is initialized empty and populated by loadMeanings
    }

    async loadMeanings(): Promise<void> {
        this.userMeaningMap.clear(); // Clear existing map before loading
        try {
            const result = await query('SELECT user_id, meaning FROM user_meanings;');
            for (const row of result.rows) {
                // Ensure user_id from DB is treated as lowercase for map key consistency
                this.userMeaningMap.set(row.user_id.toLowerCase(), row.meaning);
            }
            console.log('User meanings loaded from database.');
        } catch (error) {
            console.error('Error loading user meanings from database:', error);
            // Consider how to handle this error. For now, the map remains empty or partially filled.
        }
    }

    async setMeaning(user: string, meaning: string): Promise<void> {
        const lowerUser = user.toLowerCase();
        try {
            // Using EXCLUDED.meaning to take the new value in case of conflict and update.
            // The trigger for updated_at in schema.sql should handle the timestamp automatically.
            // If no trigger, use: updated_at = CURRENT_TIMESTAMP
            await query(
                'INSERT INTO user_meanings (user_id, meaning) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET meaning = EXCLUDED.meaning, updated_at = CURRENT_TIMESTAMP;',
                [lowerUser, meaning]
            );
            this.userMeaningMap.set(lowerUser, meaning); // Update in-memory map
            console.log(`Meaning for user ${lowerUser} set/updated in database.`);
        } catch (error) {
            console.error(`Error setting meaning for user ${lowerUser} in database:`, error);
            // Consider if the in-memory map should be updated if DB operation fails.
        }
    }

    async removeMeaning(user: string): Promise<boolean> {
        const lowerUser = user.toLowerCase();
        if (!this.userMeaningMap.has(lowerUser)) {
            console.log(`Meaning for user ${lowerUser} not found in memory. No action taken.`);
            return false; // Not in memory, so no need to query DB
        }

        try {
            const result = await query('DELETE FROM user_meanings WHERE user_id = $1;', [lowerUser]);
            if (result.rowCount > 0) {
                this.userMeaningMap.delete(lowerUser); // Update in-memory map
                console.log(`Meaning for user ${lowerUser} removed from database.`);
                return true;
            } else {
                // This case (in memory but not in DB) suggests an inconsistency.
                // Forcing consistency by removing from memory.
                this.userMeaningMap.delete(lowerUser);
                console.log(`Meaning for user ${lowerUser} not found in database for deletion, but removed from memory to ensure consistency.`);
                return false;
            }
        } catch (error) {
            console.error(`Error removing meaning for user ${lowerUser} from database:`, error);
            // If DB operation fails, we might not want to alter the in-memory map.
            return false;
        }
    }

    getUserMeaning(user: string): string {
        const lowerUser = user.toLowerCase();
        return this.userMeaningMap.get(lowerUser) || user; // Return original user if no meaning found
    }
}