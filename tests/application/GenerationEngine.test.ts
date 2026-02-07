import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const engineMocks = vi.hoisted(() => {
	return {
		generateResponse: vi.fn(),
		generateImage: vi.fn(),
		uploadImageFromBase64: vi.fn(),
		uploadImageFromUrl: vi.fn(),
	};
});

vi.mock('../../src/utils/OpenAIManager', () => ({
	OpenAIManager: class {
		generateResponse = engineMocks.generateResponse;
		generateImage = engineMocks.generateImage;

		constructor(_apiKey: string, _model: string, _gateway?: string) {}
	},
}));

vi.mock('../../src/utils/CloudflareUploader', () => ({
	CloudflareUploader: class {
		uploadImageFromBase64 = engineMocks.uploadImageFromBase64;
		uploadImageFromUrl = engineMocks.uploadImageFromUrl;

		constructor(_accountId: string, _apiToken: string) {}
	},
}));

function ensureEnv(): void {
	process.env.TWITCH_CLIENT_ID ??= 'test-client-id';
	process.env.TWITCH_CLIENT_SECRET ??= 'test-client-secret';
	process.env.TWITCH_CHANNEL ??= 'test-channel';
	process.env.TWITCH_ACCESS_TOKEN ??= 'test-access-token';
	process.env.TWITCH_REFRESH_TOKEN ??= 'test-refresh-token';
	process.env.TWITCH_ADMINS ??= 'admin';
	process.env.OPENAI_API_KEY ??= 'test-openai-key';
	process.env.OPENAI_IMAGES_PER_MINUTE ??= '20';
	process.env.OPENAI_MODEL ??= 'gpt-4.1-mini';
	process.env.DISCORD_BOT_TOKEN ??= 'test-discord-token';
	process.env.DISCORD_CHANNELS ??= '12345';
	process.env.DISCORD_ADMIN_USER_ID ??= 'admin-user-id';
	process.env.MAX_RETRIES ??= '3';
	process.env.CLOUDFLARE_ACCOUNT_ID ??= 'test-account-id';
	process.env.CLOUDFLARE_API_TOKEN ??= 'test-cf-token';
	process.env.CLOUDFLARE_IMAGES_URL ??= 'https://imagedelivery.net/test-account';
	process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/postgres';
	process.env.DB_CONNECT_TIMEOUT_MS ??= '5000';
	process.env.INTERNAL_API_BEARER_TOKEN ??= 'test-bearer';
	process.env.APP_PORT ??= '3000';
}

type GenerationEngineType = typeof import('../../src/application/GenerationEngine').GenerationEngine;
let GenerationEngine: GenerationEngineType;

function createLimiter() {
	return {
		openai: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
		image: async <T>(operation: () => Promise<T>): Promise<T> => operation(),
	} as never;
}

function createArgs() {
	return {
		jobId: 'job-123',
		userName: 'minecraft',
		userDisplayName: 'Minecraft',
		theme: undefined,
		style: 'glitch',
		attempt: 1,
		metadata: {
			target: 'Minecraft',
		},
		getMeaning: async () => 'minecraft',
		onProviderCall: async () => undefined,
	};
}

describe('GenerationEngine', () => {
	beforeAll(async () => {
		ensureEnv();
		({ GenerationEngine } = await import('../../src/application/GenerationEngine'));
	});

	beforeEach(() => {
		vi.restoreAllMocks();
		engineMocks.generateResponse.mockReset();
		engineMocks.generateImage.mockReset();
		engineMocks.uploadImageFromBase64.mockReset();
		engineMocks.uploadImageFromUrl.mockReset();

		engineMocks.generateResponse.mockResolvedValueOnce({ step2: {} }).mockResolvedValueOnce('final prompt');
		engineMocks.generateImage.mockResolvedValue({
			data: [{ b64_json: 'aGVsbG8=' }],
		});
	});

	it('uses the first Cloudflare variant URL when available', async () => {
		engineMocks.uploadImageFromBase64.mockResolvedValueOnce({
			success: true,
			result: {
				id: 'img_var',
				filename: 'image.png',
				uploaded: '2026-02-07T21:07:18.704Z',
				requireSignedURLs: false,
				variants: ['https://imagedelivery.net/example/img_var/public'],
			},
		});

		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
		const engine = new GenerationEngine(createLimiter(), 'api-key', 'model', 'account-id', 'api-token');
		const result = await engine.generate(createArgs());

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.imageUrl).toBe('https://imagedelivery.net/example/img_var/public');
			expect(result.publicImageUrl).toBe(`${process.env.CLOUDFLARE_IMAGES_URL!}/img_var.png`);
		}
		expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('generation:ok'));
	});

	it('falls back to env-based URL when Cloudflare variants are absent', async () => {
		engineMocks.uploadImageFromBase64.mockResolvedValueOnce({
			success: true,
			result: {
				id: 'img_env',
				filename: 'image.png',
				variants: [],
			},
		});

		const engine = new GenerationEngine(createLimiter(), 'api-key', 'model', 'account-id', 'api-token');
		const result = await engine.generate(createArgs());

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.imageUrl).toBe(`${process.env.CLOUDFLARE_IMAGES_URL!}/img_env.png`);
			expect(result.publicImageUrl).toBe(`${process.env.CLOUDFLARE_IMAGES_URL!}/img_env.png`);
		}
	});

	it('logs explicit generation:failed lines when upload validation fails', async () => {
		engineMocks.uploadImageFromBase64.mockResolvedValueOnce({
			success: false,
			errors: [{ message: 'Upload failed due to malformed payload' }],
		});

		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
		const engine = new GenerationEngine(createLimiter(), 'api-key', 'model', 'account-id', 'api-token');
		const result = await engine.generate(createArgs());

		expect(result).toEqual({
			success: false,
			message: 'Upload failed due to malformed payload',
			attempt: 1,
		});
		expect(
			logSpy.mock.calls.some(([line]) => {
				return (
					typeof line === 'string' &&
					line.includes('generation:failed') &&
					line.includes('Upload failed due to malformed payload')
				);
			}),
		).toBe(true);
	});
});
