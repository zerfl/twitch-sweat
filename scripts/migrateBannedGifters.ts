import { promises as fs } from 'fs';
import * as path from 'path';
import { query, getPool } from '../src/utils/DatabaseManager';
import '../src/env'; // Ensures .env variables are loaded

// broadcaster_id (key) to array of gifter_user_id (strings)
type BannedGiftersFormat = Record<string, string[]>;

async function migrateBannedGifters() {
    console.log('Starting banned_gifters.json migration to banned_gifters table...');

    const projectRootDir = path.resolve(__dirname, '..');
    const filePath = path.join(projectRootDir, 'data', 'banned_gifters.json');
    console.log(`Attempting to read banned_gifters.json from: ${filePath}`);

    let oldData: BannedGiftersFormat;
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        oldData = JSON.parse(fileContent);
        if (typeof oldData !== 'object' || oldData === null) {
            console.error('Error: banned_gifters.json is not a valid JSON object. Migration aborted.');
            return;
        }
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.log(`banned_gifters.json not found at ${filePath}. No data to migrate.`);
            return;
        }
        console.error(`Error reading or parsing banned_gifters.json at ${filePath}:`, error);
        return;
    }

    const allUniqueBannedGifters = new Set<string>();
    let malformedEntries = 0;

    for (const broadcasterId in oldData) {
        const gifters = oldData[broadcasterId];
        if (!Array.isArray(gifters)) {
            console.warn(`Data for broadcaster "${broadcasterId}" is not an array. Skipping.`);
            malformedEntries++;
            continue;
        }
        for (const gifter of gifters) {
            if (typeof gifter === 'string' && gifter.trim() !== '') {
                allUniqueBannedGifters.add(gifter.toLowerCase());
            } else {
                console.warn(`Invalid gifter entry for broadcaster "${broadcasterId}": ${gifter}. Skipping.`);
                malformedEntries++;
            }
        }
    }

    if (malformedEntries > 0) {
        console.warn(`Encountered ${malformedEntries} malformed entries during data aggregation.`);
    }
    console.log(`Found ${allUniqueBannedGifters.size} unique gifter_user_ids to migrate to the global banned_gifters list.`);

    let migratedCount = 0;
    let skippedByConflictCount = 0; // Count entries skipped due to ON CONFLICT
    let errorCount = 0;

    for (const lowerGifter of allUniqueBannedGifters) {
        try {
            const result = await query(
                'INSERT INTO banned_gifters (gifter_user_id, banned_at) VALUES ($1, CURRENT_TIMESTAMP) ON CONFLICT (gifter_user_id) DO NOTHING;',
                [lowerGifter]
            );
            if (result.rowCount > 0) {
                migratedCount++;
            } else {
                // This means the gifter_user_id already existed, and ON CONFLICT DO NOTHING was triggered.
                skippedByConflictCount++;
            }
        } catch (dbError) {
            console.error(`Failed to migrate gifter "${lowerGifter}" to global banned_gifters list:`, dbError);
            errorCount++;
        }
    }
    console.log(`Banned gifters migration complete. Migrated ${migratedCount} new unique gifters. Skipped (already existed): ${skippedByConflictCount}. Errors: ${errorCount}.`);
}

const pool = getPool();

migrateBannedGifters()
    .then(() => {
        console.log('Banned gifters migration script finished successfully.');
    })
    .catch(err => {
        console.error('Unhandled error during banned gifters migration:', err);
    })
    .finally(() => {
        if (pool) {
            pool.end(() => {
                console.log('Database pool closed for banned_gifters migration.');
            });
        }
    });
