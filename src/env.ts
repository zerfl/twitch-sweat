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
		DATABASE_URL: Joi.string().uri(),
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
	DATABASE_URL: string;
};
