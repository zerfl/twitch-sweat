import { promises as fs } from 'fs';
import * as path from 'path';
// Adjust the import path based on your project structure and how DatabaseManager exports.
// If DatabaseManager exports 'query' and 'pool' as named exports:
import { query, getPool } from '../src/utils/DatabaseManager';
// If 'env' is not automatically loaded by DatabaseManager or for other reasons, you might need:
import '../src/env'; // This ensures .env variables are loaded for DatabaseManager

type SingleImage = {
    image: string; // maps to cloudflare_image_url
    analysis: string;
    revisedPrompt: string;
    date: string; // needs conversion
};

// This is the top-level structure of images.json
type BroadcasterImagesFormat = {
    [broadcaster: string]: {
        [user: string]: SingleImage[];
    };
};

async function migrateImages() {
    console.log('Starting images.json migration to image_generation_logs table...');

    // Path relative from `scripts/` directory to `data/images.json`
    // __dirname in an ES module context might behave differently or not be available.
    // Using path.resolve with process.cwd() can be more reliable for scripts.
    // Assuming script is run from project root like `ts-node scripts/migrateImagesJson.ts`
    // If run from `scripts/` dir, `../data/images.json` is fine.
    // For robustness, let's construct path from project root.
    const projectRootDir = path.resolve(__dirname, '..'); // Goes up one level from /scripts to project root
    const filePath = path.join(projectRootDir, 'data', 'images.json');

    console.log(`Attempting to read images.json from: ${filePath}`);

    let oldData: BroadcasterImagesFormat;
    try {
        const fileContent = await fs.readFile(filePath, 'utf-8');
        oldData = JSON.parse(fileContent);
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            console.log(`images.json not found at ${filePath}. No data to migrate.`);
            return;
        }
        console.error(`Error reading or parsing images.json at ${filePath}:`, error);
        return;
    }

    let migratedCount = 0;
    let skippedCount = 0;
    const totalRecordsToProcess = Object.values(oldData).reduce((acc, broadcasterData) => {
        return acc + Object.values(broadcasterData).reduce((sum, images) => sum + images.length, 0);
    }, 0);

    console.log(`Found ${totalRecordsToProcess} image records in images.json to process.`);

    for (const broadcaster in oldData) {
        const lowerBroadcaster = broadcaster.toLowerCase();
        for (const user in oldData[broadcaster]) {
            const lowerUser = user.toLowerCase();
            const images: SingleImage[] = oldData[broadcaster][user];

            for (const imgData of images) {
                let generationTimestamp: string;
                try {
                    const dateObj = new Date(imgData.date);
                    if (isNaN(dateObj.getTime())) { // Check for invalid date
                        throw new Error('Invalid date string');
                    }
                    generationTimestamp = dateObj.toISOString();
                } catch (e) {
                    console.warn(`Invalid date format "${imgData.date}" for ${lowerBroadcaster}/${lowerUser} (Image URL: ${imgData.image}). Using current timestamp instead.`);
                    generationTimestamp = new Date().toISOString();
                }

                const sql = `
                    INSERT INTO image_generation_logs (
                        user_id, cloudflare_image_url, analysis, revised_prompt,
                        generation_timestamp, trigger_event, success, raw_user_input, openai_request_prompt
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (cloudflare_image_url) DO NOTHING;
                    -- broadcaster_id column removed, parameter placeholders adjusted.
                    -- Assuming cloudflare_image_url should be unique for migrated entries.
                    -- If not, ON CONFLICT might need adjustment or removal if duplicates are acceptable or handled differently.
                    -- The schema has request_id SERIAL PRIMARY KEY, so new rows always get new IDs.
                    -- A conflict on other unique constraints (if added) would be relevant here.
                    -- For now, using cloudflare_image_url as a pseudo-key for conflict avoidance from JSON.
                `;

                const params = [
                    lowerUser,              // $1 user_id
                    imgData.image,          // $2 cloudflare_image_url
                    imgData.analysis,       // $3 analysis
                    imgData.revisedPrompt,  // $4 revised_prompt
                    generationTimestamp,    // $5 generation_timestamp
                    'migrated_from_json',   // $6 trigger_event
                    true,                   // $7 success
                    `Migrated: ${user} in ${broadcaster}'s data`, // $8 raw_user_input (placeholder, broadcaster is from JSON key)
                    'N/A for migrated JSON' // $9 openai_request_prompt (placeholder)
                ];

                try {
                    const result = await query(sql, params);
                    if (result.rowCount > 0) {
                        migratedCount++;
                    } else {
                        // This could be due to ON CONFLICT DO NOTHING if the image URL already exists
                        // Log still includes broadcaster from JSON for context, even if not stored in DB
                        console.log(`Image for ${lowerBroadcaster}/${lowerUser} (URL: ${imgData.image}) may already exist or was skipped by conflict rule.`);
                        skippedCount++;
                    }
                } catch (dbError) {
                    // Log still includes broadcaster from JSON for context
                    console.error(`Failed to migrate image for ${lowerBroadcaster}/${lowerUser} (URL: ${imgData.image}):`, dbError);
                    skippedCount++;
                }
            }
        }
    }
    console.log(`Migration complete. Migrated ${migratedCount} new image records. Skipped/already existed: ${skippedCount}.`);
}

// Get the pool instance for shutdown
const pool = getPool();

migrateImages()
    .then(() => {
        console.log('Image migration script finished successfully.');
    })
    .catch(err => {
        console.error('Unhandled error during image migration process:', err);
    })
    .finally(() => {
        if (pool) {
            pool.end(() => {
                console.log('Database pool closed.');
            });
        }
    });
