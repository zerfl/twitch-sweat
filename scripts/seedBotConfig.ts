import { BotConfigManager } from '../src/managers/BotConfigManager';
import { env } from '../src/env'; // Ensure this is loaded to access process.env validated values
import { getPool } from '../src/utils/DatabaseManager'; // For closing the pool

// Define which environment variables should be seeded into the bot_configuration table
// and their corresponding database keys.
const configKeysToSeed = [
    // Twitch Authentication
    { envKey: 'TWITCH_CLIENT_ID', dbKey: 'twitch_client_id', isOptional: false },
    { envKey: 'TWITCH_CLIENT_SECRET', dbKey: 'twitch_client_secret', isOptional: false },
    { envKey: 'TWITCH_ACCESS_TOKEN', dbKey: 'twitch_access_token', isOptional: false }, // Usually obtained after initial auth, but can be pre-seeded
    { envKey: 'TWITCH_REFRESH_TOKEN', dbKey: 'twitch_refresh_token', isOptional: true }, // May not exist for all grant types or initially

    // Add other configurations you want to seed from .env to the database
    // Example: OpenAI API Key (if you choose to store it in DB instead of only .env)
    // { envKey: 'OPENAI_API_KEY', dbKey: 'openai_api_key', isOptional: false },
];

async function seedBotConfig() {
    console.log('Starting bot configuration seeding from environment variables...');
    const botConfigManager = new BotConfigManager();
    let seededCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const { envKey, dbKey, isOptional } of configKeysToSeed) {
        // Accessing env variables through the validated 'env' object from src/env.ts
        const valueFromEnv = env[envKey as keyof typeof env] as string | undefined;

        if (valueFromEnv && typeof valueFromEnv === 'string' && valueFromEnv.trim() !== '') {
            try {
                // Check if the key already exists and has the same value
                const currentValue = await botConfigManager.getConfig(dbKey);
                if (currentValue === valueFromEnv) {
                    console.log(`Config key "${dbKey}" already set to the correct value. Skipping.`);
                    skippedCount++;
                    continue;
                }
                await botConfigManager.setConfig(dbKey, valueFromEnv);
                console.log(`Successfully seeded config key "${dbKey}" from environment variable "${envKey}".`);
                seededCount++;
            } catch (error) {
                console.error(`Error seeding config key "${dbKey}" from "${envKey}":`, error);
                errorCount++;
            }
        } else {
            if (isOptional) {
                console.log(`Optional environment variable "${envKey}" for DB key "${dbKey}" is not set or is empty. Skipping.`);
            } else {
                console.warn(`REQUIRED environment variable "${envKey}" for DB key "${dbKey}" is not set or is empty. Skipping. This may cause issues.`);
            }
            skippedCount++;
        }
    }

    console.log(`Bot configuration seeding complete. Seeded/Updated: ${seededCount} keys. Skipped: ${skippedCount} keys. Errors: ${errorCount}.`);
    if (errorCount > 0 || skippedCount > 0) {
        console.warn('Please check warnings/errors above. Some configurations might be missing or failed to seed.');
    }
}

// Get the pool for graceful shutdown
const pool = getPool();

seedBotConfig()
    .then(() => {
        console.log('Bot configuration seeding script finished.');
    })
    .catch(err => {
        console.error('Unhandled error during bot configuration seeding process:', err);
    })
    .finally(() => {
        if (pool) {
            pool.end(() => {
                console.log('Database pool closed for seedBotConfig script.');
            });
        } else {
            console.warn('Database pool was not available for closing. Ensure DatabaseManager exports getPool().');
        }
    });
