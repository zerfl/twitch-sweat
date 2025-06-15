-- Table to log image generation requests and their outcomes for a single-broadcaster setup
CREATE TABLE image_generation_logs (
    request_id SERIAL PRIMARY KEY, -- Auto-incrementing ID for each log entry
    user_id TEXT NOT NULL, -- User who initiated the request
    trigger_event TEXT NOT NULL, -- e.g., "chat_command", "reward_redemption"
    raw_user_input TEXT NOT NULL, -- The original input from the user
    openai_request_prompt TEXT NOT NULL, -- The prompt sent to OpenAI/DALL-E
    openai_request_parameters JSONB, -- Parameters like size, quality
    openai_response_data JSONB, -- Metadata from OpenAI, if any
    generated_image_url TEXT, -- Internal or temporary URL of the image (e.g., DALL-E URL)
    cloudflare_image_url TEXT, -- Final public URL from Cloudflare Images
    generation_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    success BOOLEAN NOT NULL,
    error_message TEXT, -- Nullable, stores error details if any
    discord_message_id TEXT, -- Nullable, ID of the Discord message where image was posted
    analysis TEXT, -- Nullable, stores the image analysis (e.g., from OpenAI vision)
    revised_prompt TEXT -- Nullable, stores the revised prompt from DALL-E, if any
);

-- Indexes for image_generation_logs
CREATE INDEX IF NOT EXISTS idx_image_generation_logs_user_id ON image_generation_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_image_generation_logs_discord_message_id ON image_generation_logs(discord_message_id);
CREATE INDEX IF NOT EXISTS idx_image_generation_logs_success ON image_generation_logs(success);
CREATE INDEX IF NOT EXISTS idx_image_generation_logs_trigger_event ON image_generation_logs(trigger_event);
CREATE INDEX IF NOT EXISTS idx_image_generation_logs_cloudflare_url ON image_generation_logs(cloudflare_image_url);


-- Table to store reactions to Discord messages (remains global, linked by discord_message_id)
CREATE TABLE discord_message_reactions (
    reaction_id SERIAL PRIMARY KEY,
    discord_message_id TEXT NOT NULL, -- ID of the Discord message that received a reaction
    user_id TEXT NOT NULL, -- Discord User ID of the user who added the reaction
    emoji TEXT NOT NULL, -- Unicode emoji or custom Discord emoji ID
    reaction_timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for discord_message_reactions
CREATE INDEX IF NOT EXISTS idx_discord_message_reactions_message_id ON discord_message_reactions(discord_message_id);
CREATE INDEX IF NOT EXISTS idx_discord_message_reactions_message_user_emoji ON discord_message_reactions(discord_message_id, user_id, emoji);


-- Table for storing global bot configuration settings
CREATE TABLE bot_configuration (
    config_key TEXT PRIMARY KEY, -- The name of the configuration setting (e.g., "OPENAI_API_KEY", "current_bot_theme")
    config_value TEXT NOT NULL, -- The value of the configuration setting
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP -- Automatically updated when the row changes
);

-- Trigger to update 'updated_at' timestamp on row update for bot_configuration
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_bot_configuration_modtime
BEFORE UPDATE ON bot_configuration
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();


-- Table to store a global list of banned gifter user IDs
-- These users are banned from having images generated for them via gift events.
CREATE TABLE banned_gifters (
    gifter_user_id TEXT PRIMARY KEY, -- The user ID of the gifter who is banned globally
    banned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP -- Timestamp of when the ban was applied
);


-- Table for users to be ignored by the bot globally (prevents image generation for them)
CREATE TABLE ignore_list (
    user_id TEXT PRIMARY KEY, -- The user ID to be ignored
    added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP -- When the user was added to the ignore list
);


-- Table to store user-defined "meanings" for themselves (global)
CREATE TABLE user_meanings (
    meaning_id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE, -- The user ID for whom the meaning is defined
    meaning TEXT NOT NULL, -- The user-defined meaning
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Index for user_meanings
CREATE INDEX IF NOT EXISTS idx_user_meanings_user_id ON user_meanings(user_id);

-- Trigger to update 'updated_at' timestamp on row update for user_meanings
CREATE TRIGGER update_user_meanings_modtime
BEFORE UPDATE ON user_meanings
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();

-- The bot's global theme is stored in the bot_configuration table
-- with a specific config_key, for example: 'global_bot_theme'.
-- The broadcaster_themes table has been removed.

-- Comments Section
COMMENT ON TABLE image_generation_logs IS 'Stores logs of all image generation requests, including user inputs, OpenAI interactions, and outcomes. Adapted for a single-broadcaster model.';
COMMENT ON COLUMN image_generation_logs.user_id IS 'Identifier of the user who made or was the target of the image generation request.';
COMMENT ON COLUMN image_generation_logs.trigger_event IS 'The event that triggered the image generation (e.g., "twitch_sub", "twitch_gift", "discord_command").';

COMMENT ON TABLE discord_message_reactions IS 'Tracks reactions (emojis) added to messages sent by the bot on Discord.';

COMMENT ON TABLE bot_configuration IS 'A key-value store for global bot configuration settings, including API keys, operational parameters, and the global bot theme.';
COMMENT ON COLUMN bot_configuration.config_key IS 'The unique key identifying a configuration setting.';
COMMENT ON COLUMN bot_configuration.config_value IS 'The value of the configuration setting.';

COMMENT ON TABLE banned_gifters IS 'Maintains a global list of user IDs banned from having images generated for them via gifting events.';
COMMENT ON COLUMN banned_gifters.gifter_user_id IS 'The user ID of the gifter who has been banned.';

COMMENT ON TABLE ignore_list IS 'A global list of user IDs that the bot should ignore for image generation requests.';
COMMENT ON COLUMN ignore_list.user_id IS 'The user ID of the person to be ignored.';

COMMENT ON TABLE user_meanings IS 'Stores custom "meanings" or descriptions users can associate with their user ID, used in prompt generation.';
COMMENT ON COLUMN user_meanings.user_id IS 'The user ID to which the meaning is attached.';
COMMENT ON COLUMN user_meanings.meaning IS 'The custom text or "meaning" provided by the user.';

-- End of schema.sql
