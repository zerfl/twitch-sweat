declare global {
	namespace NodeJS {
		interface ProcessEnv {
			TWITCH_CLIENT_ID: string;
			TWITCH_CLIENT_SECRET: string;
			TWITCH_ACCESS_TOKEN: string;
			TWITCH_REFRESH_TOKEN: string;
			TWITCH_CHANNELS: string;
			OPENAI_IMAGES_PER_MINUTE: string;
			OPENAI_ANALYZER_PROMPT: string;
			OPENAI_SCENARIO_PROMPT: string;
			DISCORD_BOT_TOKEN: string;
			DISCORD_CHANNELS: string;
			DISCORD_ADMIN_USER_ID: string;
			MAX_RETRIES: string;
			CLOUDFLARE_ACCOUNT_ID: string;
			CLOUDFLARE_API_TOKEN: string;
			CLOUDFLARE_IMAGES_URL: string;
		}
	}
}
