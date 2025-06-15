import { promises as fs } from 'fs';
import * as path from 'path';
import { query, getPool } from '../src/utils/DatabaseManager';
import '../src/env'; // Ensures .env variables are loaded

type IgnoreListFormat = string[];

async function migrateIgnoreList() {
    console.log('Starting ignore_list.json migration to ignore_list table...');

    const projectRootDir = path.resolve(__dirname, '..');
    const filePath = path.join(projectRootDir, 'data', 'ignore_list.json');
    console.log(`Attempting to read ignore_list.json from: ${filePath}`);

    let oldData: IgnoreListFormat;
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        oldData = JSON.parse(fileContent);
        if (!Array.isArray(oldData)) {
            console.error('Error: ignore_list.json is not a valid JSON array. Migration aborted.');
            return;
        }
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.log(`ignore_list.json not found at ${filePath}. No data to migrate.`);
            return;
        }
        console.error(`Error reading or parsing ignore_list.json at ${filePath}:`, error);
        return;
    }

    let migratedCount = 0;
    let skippedCount = 0;
    console.log(`Found ${oldData.length} user_ids in ignore_list.json to process.`);

    for (const user of oldData) {
        if (typeof user !== 'string') {
            console.warn(`Skipping invalid entry in ignore_list.json: ${JSON.stringify(user)}`);
            skippedCount++;
            continue;
        }
        const lowerUser = user.toLowerCase();
        try {
            const result = await query(
                'INSERT INTO ignore_list (user_id, added_at) VALUES ($1, CURRENT_TIMESTAMP) ON CONFLICT (user_id) DO NOTHING;',
                [lowerUser]
            );
            if (result.rowCount > 0) {
                migratedCount++;
            } else {
                skippedCount++;
            }
        } catch (dbError) {
            console.error(`Failed to migrate user "${lowerUser}" to ignore_list:`, dbError);
            skippedCount++;
        }
    }
    console.log(`Ignore list migration complete. Migrated ${migratedCount} new users. Skipped/already existed: ${skippedCount}.`);
}

const pool = getPool();

migrateIgnoreList()
    .then(() => {
        console.log('Ignore list migration script finished successfully.');
    })
    .catch(err => {
        console.error('Unhandled error during ignore list migration:', err);
    })
    .finally(() => {
        if (pool) {
            pool.end(() => {
                console.log('Database pool closed for ignore_list migration.');
            });
        }
    });
