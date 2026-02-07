import 'dotenv/config';
import Joi from 'joi';

export interface EnvVars {
	TWITCH_CLIENT_ID: string;
	TWITCH_CLIENT_SECRET: string;
	TWITCH_CHANNEL: string;
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
	DATABASE_URL: string;
	DB_CONNECT_TIMEOUT_MS: number;
	INTERNAL_API_BEARER_TOKEN: string;
	APP_PORT: number;
}

const envSchema = Joi.object()
	.keys({
		TWITCH_CLIENT_ID: Joi.string().required(),
		TWITCH_CLIENT_SECRET: Joi.string().required(),
		TWITCH_CHANNEL: Joi.string().required(),
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
		DATABASE_URL: Joi.string().uri().required(),
		DB_CONNECT_TIMEOUT_MS: Joi.number().integer().min(1000).default(5000),
		INTERNAL_API_BEARER_TOKEN: Joi.string().required(),
		APP_PORT: Joi.number().integer().min(1).max(65535).default(3000),
	})
	.unknown();

const validationResult = envSchema.prefs({ errors: { label: 'key' } }).validate(process.env) as {
	value: unknown;
	error?: Joi.ValidationError;
};

if (validationResult.error) {
	throw new Error(`Config validation error: ${validationResult.error.message}`);
}

export const env = validationResult.value as EnvVars;
