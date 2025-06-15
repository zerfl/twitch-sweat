import { query } from '../utils/DatabaseManager'; // Adjust path as necessary

const TWITCH_ACCESS_TOKEN_KEY = 'twitch_access_token';
const TWITCH_REFRESH_TOKEN_KEY = 'twitch_refresh_token';
const TWITCH_CLIENT_ID_KEY = 'twitch_client_id';
const TWITCH_CLIENT_SECRET_KEY = 'twitch_client_secret';
const CURRENT_BOT_THEME_KEY = 'current_bot_theme'; // New constant for the theme key
// Add other specific config keys here as constants if needed

export class BotConfigManager {

    constructor() {
        // Constructor is empty as DatabaseManager should be self-configuring (e.g., via environment variables)
    }

    /**
     * Retrieves a configuration value from the bot_configuration table.
     * @param key The configuration key.
     * @returns The configuration value if found, otherwise null.
     * @throws Throws an error if the database query fails.
     */
    public async getConfig(key: string): Promise<string | null> {
        try {
            const result = await query('SELECT config_value FROM bot_configuration WHERE config_key = $1;', [key]);
            if (result.rows.length > 0) {
                return result.rows[0].config_value;
            }
            return null; // Key not found
        } catch (error) {
            console.error(`Error getting config for key "${key}":`, error);
            // Re-throwing the error allows the caller to decide on further handling.
            // Alternatively, could return a specific error object or null, but throwing is often clearer for unexpected DB issues.
            throw error;
        }
    }

    /**
     * Sets or updates a configuration value in the bot_configuration table.
     * The 'updated_at' field is automatically handled by the database trigger or the query itself.
     * @param key The configuration key.
     * @param value The configuration value.
     * @throws Throws an error if the database query fails.
     */
    public async setConfig(key: string, value: string): Promise<void> {
        try {
            // The schema includes a trigger to update `updated_at` on UPDATE.
            // For INSERT, we explicitly set it. The ON CONFLICT clause handles both cases.
            // If your DB schema's `updated_at` column for `bot_configuration` has a `DEFAULT CURRENT_TIMESTAMP`
            // and an `ON UPDATE CURRENT_TIMESTAMP` (like some MySQL setups, though PostgreSQL is different),
            // you might not need to specify `updated_at` in the query for updates.
            // However, the provided schema.sql has a trigger `update_modified_column` for `updated_at`,
            // so `SET updated_at = CURRENT_TIMESTAMP` in the `DO UPDATE` part is correct.
            await query(
                'INSERT INTO bot_configuration (config_key, config_value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = CURRENT_TIMESTAMP;',
                [key, value]
            );
            console.log(`Config for key "${key}" set/updated in database.`);
        } catch (error) {
            console.error(`Error setting config for key "${key}":`, error);
            throw error;
        }
    }

    // --- Twitch Specific Getters/Setters ---

    public async getTwitchAccessToken(): Promise<string | null> {
        return this.getConfig(TWITCH_ACCESS_TOKEN_KEY);
    }

    public async setTwitchAccessToken(token: string): Promise<void> {
        return this.setConfig(TWITCH_ACCESS_TOKEN_KEY, token);
    }

    public async getTwitchRefreshToken(): Promise<string | null> {
        return this.getConfig(TWITCH_REFRESH_TOKEN_KEY);
    }

    public async setTwitchRefreshToken(token: string): Promise<void> {
        return this.setConfig(TWITCH_REFRESH_TOKEN_KEY, token);
    }

    public async getTwitchClientId(): Promise<string | null> {
        return this.getConfig(TWITCH_CLIENT_ID_KEY);
    }

    public async setTwitchClientId(id: string): Promise<void> {
        return this.setConfig(TWITCH_CLIENT_ID_KEY, id);
    }

    public async getTwitchClientSecret(): Promise<string | null> {
        return this.getConfig(TWITCH_CLIENT_SECRET_KEY);
    }

    public async setTwitchClientSecret(secret: string): Promise<void> {
        return this.setConfig(TWITCH_CLIENT_SECRET_KEY, secret);
    }

    // --- Other specific config getters/setters can be added below ---
    // Example: OpenAI API Key
    // public async getOpenAIApiKey(): Promise<string | null> {
    //     return this.getConfig('openai_api_key');
    // }
    //
    // public async setOpenAIApiKey(apiKey: string): Promise<void> {
    //     return this.setConfig('openai_api_key', apiKey);
    // }

    // --- Bot Theme Specific Getters/Setters ---

    /**
     * Retrieves the current global bot theme from configuration.
     * @returns The theme string if set, otherwise null.
     */
    public async getCurrentBotTheme(): Promise<string | null> {
        return this.getConfig(CURRENT_BOT_THEME_KEY);
    }

    /**
     * Sets the current global bot theme in configuration.
     * @param theme The theme string to set.
     */
    public async setCurrentBotTheme(theme: string): Promise<void> {
        if (theme === null || typeof theme === 'undefined') {
            // Or handle this case by deleting the key if you want to "unset" the theme
            console.warn(`Attempted to set current bot theme to null or undefined. Storing as empty string or specific placeholder if necessary, or consider a 'removeTheme' method.`);
            // For now, let setConfig handle it; it might store it as "null" string or fail depending on DB constraints if value is NOT NULL.
            // The current setConfig expects a string. An empty string might be preferable to "null" or "undefined".
            // Let's ensure we pass a string. If `theme` should be unset, a separate method `removeConfig(key)` would be better.
            // For now, we'll proceed with setting the provided value, which could be an empty string.
        }
        console.log(`Setting current bot theme in DB to: "${theme}"`);
        return this.setConfig(CURRENT_BOT_THEME_KEY, theme);
    }
}
