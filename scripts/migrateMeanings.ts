import { promises as fs } from 'fs';
import * as path from 'path';
import { query, getPool } from '../src/utils/DatabaseManager';
import '../src/env'; // Ensures .env variables are loaded

// user_id (key) to meaning (string)
type MeaningsFormat = Record<string, string>;

async function migrateMeanings() {
    console.log('Starting meanings.json migration to user_meanings table...');

    const projectRootDir = path.resolve(__dirname, '..');
    const filePath = path.join(projectRootDir, 'data', 'meanings.json');
    console.log(`Attempting to read meanings.json from: ${filePath}`);

    let oldData: MeaningsFormat;
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        oldData = JSON.parse(fileContent);
        if (typeof oldData !== 'object' || oldData === null) {
            console.error('Error: meanings.json is not a valid JSON object. Migration aborted.');
            return;
        }
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.log(`meanings.json not found at ${filePath}. No data to migrate.`);
            return;
        }
        console.error(`Error reading or parsing meanings.json at ${filePath}:`, error);
        return;
    }

    let migratedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;
    const totalEntries = Object.keys(oldData).length;
    console.log(`Found ${totalEntries} user meanings in meanings.json to process.`);

    for (const userId in oldData) {
        const lowerUserId = userId.toLowerCase();
        const meaning = oldData[userId];

        if (typeof meaning !== 'string') {
            console.warn(`Skipping invalid meaning for user "${lowerUserId}": not a string. Value: ${JSON.stringify(meaning)}`);
            skippedCount++;
            continue;
        }

        try {
            // ON CONFLICT (user_id) DO UPDATE SET meaning = EXCLUDED.meaning, updated_at = CURRENT_TIMESTAMP;
            // This will insert if new, or update the meaning and timestamp if user_id already exists.
            const result = await query(
                'INSERT INTO user_meanings (user_id, meaning, created_at, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT (user_id) DO UPDATE SET meaning = EXCLUDED.meaning, updated_at = CURRENT_TIMESTAMP RETURNING meaning_id;',
                [lowerUserId, meaning]
            );
            // To distinguish between insert and update, one might check if created_at equals updated_at after the query,
            // or by selecting the row before attempting an insert/update.
            // However, rowCount from INSERT ON CONFLICT DO UPDATE in PostgreSQL usually returns 1 for both insert and update.
            // For simplicity, we'll just log a general "processed" message or count all as "migrated/updated".
            // Let's assume we want to count how many were newly inserted vs updated.
            // A common way is to check if the existing meaning was different, or if xmax system column is 0 for insert.
            // Given the current tools, a simpler approach is to just report a combined number.
            // For now, if rowCount is >0, it means an operation happened.
            if (result.rowCount > 0) {
                 // This doesn't reliably tell insert vs update with ON CONFLICT DO UPDATE without more complex logic.
                 // We'll count it as "processed" (either inserted or updated).
                migratedCount++;
            } else {
                // This case should ideally not happen with ON CONFLICT DO UPDATE unless there's an issue.
                // It might occur if the meaning was identical and updated_at was not changed due to some trigger precision.
                console.warn(`No rows affected for user "${lowerUserId}". This might indicate an issue or identical existing data.`);
                skippedCount++;
            }
        } catch (dbError) {
            console.error(`Failed to migrate meaning for user "${lowerUserId}":`, dbError);
            skippedCount++;
        }
    }
    // The count here will reflect rows that were either inserted or updated.
    console.log(`User meanings migration complete. Processed (inserted or updated) ${migratedCount} meanings. Skipped due to errors or no operation: ${skippedCount}.`);
}

const pool = getPool();

migrateMeanings()
    .then(() => {
        console.log('User meanings migration script finished successfully.');
    })
    .catch(err => {
        console.error('Unhandled error during user meanings migration:', err);
    })
    .finally(() => {
        if (pool) {
            pool.end(() => {
                console.log('Database pool closed for user_meanings migration.');
            });
        }
    });
