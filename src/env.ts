import 'dotenv/config';
import Joi from 'joi';

const envSchema = Joi.object()
	.keys({
		TWITCH_CLIENT_ID: Joi.string().required(),
		TWITCH_CLIENT_SECRET: Joi.string().required(),
		TWITCH_CHANNELS: Joi.string().required(),
		TWITCH_ACCESS_TOKEN: Joi.string().required(),
		TWITCH_REFRESH_TOKEN: Joi.string().required(),
		TWITCH_ADMINS: Joi.string().required(),
		OPENAI_API_KEY: Joi.string().required(),
		OPENAI_IMAGES_PER_MINUTE: Joi.number().integer().min(1).required(),
		OPENAI_MODEL: Joi.string().required(),
		DISCORD_BOT_TOKEN: Joi.string().required(),
		DISCORD_CHANNELS: Joi.string().required(),
		DISCORD_ADMIN_USER_ID: Joi.string().required(),
		MAX_RETRIES: Joi.number().integer().min(1).default(3),
		CLOUDFLARE_ACCOUNT_ID: Joi.string().required(),
		CLOUDFLARE_API_TOKEN: Joi.string().required(),
		CLOUDFLARE_IMAGES_URL: Joi.string().uri().required(),
		CLOUDFLARE_AI_GATEWAY: Joi.string().uri().optional(),
		// PostgreSQL Connection (individual params)
		DB_HOST: Joi.string().hostname().default('localhost'),
		DB_PORT: Joi.number().port().default(5432),
		DB_USER: Joi.string().required(),
		DB_PASSWORD: Joi.string().required(),
		DB_NAME: Joi.string().required(),
		DB_SSL_REQUIRED: Joi.boolean().default(false),
		// DATABASE_URL is optional if individual params are provided
		DATABASE_URL: Joi.string().uri().optional(),
		// Discord Reaction Emojis
		DISCORD_UPVOTE_EMOJI: Joi.string().default('👍'),
		DISCORD_DOWNVOTE_EMOJI: Joi.string().default('👎'),
		NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
	})
	.unknown();

const { value: envVars, error } = envSchema.prefs({ errors: { label: 'key' } }).validate(process.env);

if (error) {
	throw new Error(`Config validation error: ${error.message}`);
}

export const env = envVars as {
	TWITCH_CLIENT_ID: string;
	TWITCH_CLIENT_SECRET: string;
	TWITCH_CHANNELS: string;
	TWITCH_ACCESS_TOKEN: string;
	TWITCH_REFRESH_TOKEN: string;
	TWITCH_ADMINS: string;
	OPENAI_API_KEY: string;
	OPENAI_IMAGES_PER_MINUTE: number;
	OPENAI_MODEL: string;
	DISCORD_BOT_TOKEN: string;
	DISCORD_CHANNELS: string;
	DISCORD_ADMIN_USER_ID: string;
	MAX_RETRIES: number;
	CLOUDFLARE_ACCOUNT_ID: string;
	CLOUDFLARE_API_TOKEN: string;
	CLOUDFLARE_IMAGES_URL: string;
	CLOUDFLARE_AI_GATEWAY?: string;
	DB_HOST: string;
	DB_PORT: number;
	DB_USER: string;
	DB_PASSWORD: string;
	DB_NAME: string;
	DB_SSL_REQUIRED: boolean;
	DATABASE_URL?: string; // Now optional
	DISCORD_UPVOTE_EMOJI: string;
	DISCORD_DOWNVOTE_EMOJI: string;
	NODE_ENV: string;
};
