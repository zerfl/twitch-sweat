import { BotConfigManager } from '../src/managers/BotConfigManager';
import { env } from '../src/env'; // To access env.DEFAULT_BOT_THEME
import { getPool } from '../src/utils/DatabaseManager'; // For closing the pool
import '../src/env'; // Ensures .env variables are loaded for DatabaseManager

// This script no longer migrates from JSON. It sets a global theme based on an environment variable.

// A hardcoded default theme, used if the environment variable is not set AND src/env.ts doesn't provide its own default.
// However, it's better if src/env.ts handles the default for DEFAULT_BOT_THEME.
const FALLBACK_DEFAULT_THEME = 'Default theme';

async function setGlobalBotTheme() {
    console.log('Attempting to set the global bot theme in bot_configuration table...');

    // Access DEFAULT_BOT_THEME from the validated 'env' object.
    // It's assumed that src/env.ts will define DEFAULT_BOT_THEME,
    // potentially with a Joi.default() if it's optional in the .env file.
    let themeToSet: string;

    if (env.DEFAULT_BOT_THEME !== undefined && env.DEFAULT_BOT_THEME !== null) {
        // Check if DEFAULT_BOT_THEME is part of the env object from src/env.ts
        // The 'as any' is a temporary workaround if DEFAULT_BOT_THEME is not yet formally in the env type.
        // Ideally, src/env.ts should be updated to include DEFAULT_BOT_THEME in its schema and type.
        const themeFromEnv = (env as any).DEFAULT_BOT_THEME;

        if (typeof themeFromEnv === 'string') {
            themeToSet = themeFromEnv;
            console.log(`Using theme from environment variable DEFAULT_BOT_THEME: "${themeToSet}"`);
        } else {
            themeToSet = FALLBACK_DEFAULT_THEME;
            console.warn(`DEFAULT_BOT_THEME was found but not a string, or not defined in src/env.ts. Using hardcoded fallback: "${themeToSet}"`);
        }
    } else {
        themeToSet = FALLBACK_DEFAULT_THEME;
        console.warn(`DEFAULT_BOT_THEME environment variable not set or not defined in src/env.ts. Using hardcoded fallback: "${themeToSet}"`);
    }

    const botConfigManager = new BotConfigManager();

    try {
        await botConfigManager.setCurrentBotTheme(themeToSet);
        console.log(`Successfully set global bot theme to: "${themeToSet}".`);
    } catch (error) {
        console.error('Error setting global bot theme in bot_configuration:', error);
        // Rethrow or handle as appropriate for a script
        throw error;
    }
}

// Get the pool instance for shutdown
const pool = getPool();

setGlobalBotTheme()
    .then(() => {
        console.log('Global bot theme setting script finished successfully.');
    })
    .catch(err => {
        console.error('Unhandled error during global theme setting script execution:', err);
    })
    .finally(() => {
        if (pool) {
            pool.end(() => {
                console.log('Database pool closed for setGlobalBotTheme script.');
            });
        } else {
            console.warn('Database pool was not available for closing. Ensure DatabaseManager exports getPool().');
        }
    });
