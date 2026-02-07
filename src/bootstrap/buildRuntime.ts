import { env } from '../env';
import { ApiServer } from '../api/server';
import { DiscordBotAdapter } from '../adapters/discord/DiscordBotAdapter';
import { DiscordAdminCommandRouter } from '../adapters/discord/DiscordAdminCommandRouter';
import { TwitchBotAdapter } from '../adapters/twitch/TwitchBotAdapter';
import { TwitchCommandRouter } from '../adapters/twitch/TwitchCommandRouter';
import { GenerationEngine } from '../application/GenerationEngine';
import { MessageThrottle } from '../infrastructure/throttle/MessageThrottle';
import { ProviderLimiter } from '../infrastructure/throttle/providerLimiter';
import { NotificationDispatchService } from '../application/services/NotificationDispatchService';
import { EnqueueGenerationUseCase } from '../application/usecases/EnqueueGenerationUseCase';
import { HandleDiscordAdminCommandUseCase } from '../application/usecases/HandleDiscordAdminCommandUseCase';
import { HandleTwitchEventUseCase } from '../application/usecases/HandleTwitchEventUseCase';
import { HandleTwitchCommandUseCase } from '../application/usecases/HandleTwitchCommandUseCase';
import { ProcessJobAttemptUseCase } from '../application/usecases/ProcessJobAttemptUseCase';
import { DispatchSuccessNotificationsUseCase } from '../application/usecases/DispatchSuccessNotificationsUseCase';
import { DispatchFailureNotificationsUseCase } from '../application/usecases/DispatchFailureNotificationsUseCase';
import { ProcessGenerationJobUseCase } from '../application/usecases/ProcessGenerationJobUseCase';
import { createDatabaseContext, runMigrations, verifyDatabaseConnection } from '../infrastructure/db/client';
import { AppConfigRepository } from '../infrastructure/repositories/AppConfigRepository';
import { TokenRepository } from '../infrastructure/repositories/TokenRepository';
import { PreferenceRepository } from '../infrastructure/repositories/PreferenceRepository';
import { GenerationWriteRepository } from '../infrastructure/repositories/GenerationWriteRepository';
import { GenerationQueryRepository } from '../infrastructure/repositories/GenerationQueryRepository';
import { JobWriteRepository } from '../infrastructure/repositories/JobWriteRepository';
import { JobQueryRepository } from '../infrastructure/repositories/JobQueryRepository';
import { PostgresJobWorker } from '../infrastructure/queue/PostgresJobWorker';
import { logBootstrapEvent, runBootstrapStep } from './stepRunner';
import type {
	BroadcastNotifierContract,
	ChannelNotifierContract,
} from '../application/contracts';

export interface Runtime {
	start: () => Promise<void>;
	stop: () => Promise<void>;
}

class CompositeNotifier implements BroadcastNotifierContract, ChannelNotifierContract {
	constructor(
		private readonly twitch: Pick<BroadcastNotifierContract, 'sendTwitch'>,
		private readonly discord: Pick<BroadcastNotifierContract, 'sendDiscordBroadcast'> & ChannelNotifierContract,
	) {}

	async sendTwitch(message: string): Promise<void> {
		await this.twitch.sendTwitch(message);
	}

	async sendDiscordBroadcast(message: string): Promise<void> {
		await this.discord.sendDiscordBroadcast(message);
	}

	async sendDiscordChannel(channelId: string, message: string): Promise<void> {
		await this.discord.sendDiscordChannel(channelId, message);
	}
}

export async function buildRuntime(): Promise<Runtime> {
	logBootstrapEvent('bootstrap:start');

	const broadcasterName = env.TWITCH_CHANNEL.toLowerCase();
	const twitchAdmins = new Set((env.TWITCH_ADMINS ?? '').toLowerCase().split(',').filter(Boolean));
	const discordChannels = env.DISCORD_CHANNELS.split(',').map((channel) => channel.trim()).filter(Boolean);
	const dbDiagnostics = {
		databaseUrl: env.DATABASE_URL,
		connectTimeoutMs: env.DB_CONNECT_TIMEOUT_MS,
	};

	const dbContext = createDatabaseContext(env.DATABASE_URL, env.DB_CONNECT_TIMEOUT_MS);
	await runBootstrapStep('db:connect', async () => {
		await verifyDatabaseConnection(dbContext.db, dbDiagnostics);
	});
	await runBootstrapStep('db:migrate', async () => {
		await runMigrations(dbContext.db, dbDiagnostics);
	});

	const appConfigRepository = new AppConfigRepository(dbContext.db);
	await runBootstrapStep('db:ensure-broadcaster', async () => {
		await appConfigRepository.ensureBroadcaster(broadcasterName);
	});

	const tokenRepository = new TokenRepository(dbContext.db);
	const preferenceRepository = new PreferenceRepository(dbContext.db, broadcasterName);
	const generationWriteRepository = new GenerationWriteRepository(dbContext.db);
	const generationQueryRepository = new GenerationQueryRepository(dbContext.db);
	const jobWriteRepository = new JobWriteRepository(dbContext.db);
	const jobQueryRepository = new JobQueryRepository(dbContext.db);

	const limiter = new ProviderLimiter();
	const messageThrottle = new MessageThrottle(limiter);
	const generationEngine = new GenerationEngine(
		limiter,
		env.OPENAI_API_KEY,
		env.OPENAI_MODEL,
		env.CLOUDFLARE_ACCOUNT_ID,
		env.CLOUDFLARE_API_TOKEN,
		env.CLOUDFLARE_AI_GATEWAY,
	);

	const enqueueGenerationUseCase = new EnqueueGenerationUseCase({
		jobWriteRepository,
		generationWriteRepository,
		maxRetries: env.MAX_RETRIES,
	});

	const handleTwitchEventUseCase = new HandleTwitchEventUseCase({
		enqueueGenerationUseCase,
		preferenceRepository,
		generationWriteRepository,
		broadcasterName,
	});

	const handleDiscordAdminCommandUseCase = new HandleDiscordAdminCommandUseCase({
		enqueueGenerationUseCase,
		broadcasterName,
	});

	const { activeDiscordAdapter, activeTwitchAdapter, compositeNotifier } = await runBootstrapStep(
		'adapters:init',
		() => {
			let discordAdapter: DiscordBotAdapter | null = null;
			let twitchAdapter: TwitchBotAdapter | null = null;

			const discordAdminCommandRouter = new DiscordAdminCommandRouter({
				handleDiscordAdminCommandUseCase,
				sendBroadcast: async (message: string) => {
					if (!discordAdapter) {
						throw new Error('Discord adapter not initialized');
					}
					await discordAdapter.sendDiscordBroadcast(message);
				},
			});

			discordAdapter = new DiscordBotAdapter({
				discordBotToken: env.DISCORD_BOT_TOKEN,
				discordAdminUserId: env.DISCORD_ADMIN_USER_ID,
				discordChannels,
				discordAdminCommandRouter,
			});

			const activeDiscordAdapter = discordAdapter;

			const compositeNotifier = new CompositeNotifier(
				{
					sendTwitch: async (message: string) => {
						if (!twitchAdapter) {
							throw new Error('Twitch adapter not initialized');
						}
						await twitchAdapter.sendTwitch(message);
					},
				},
				activeDiscordAdapter,
			);

			const handleTwitchCommandUseCase = new HandleTwitchCommandUseCase({
				twitchAdmins,
				maxRetries: env.MAX_RETRIES,
				messageThrottle,
				preferenceRepository,
				handleTwitchEventUseCase,
				imageGenerator: generationEngine,
				generationWriteRepository,
				generationQueryRepository,
				jobQueryRepository,
				broadcastNotifier: compositeNotifier,
				broadcasterName,
			});

			const twitchCommandRouter = new TwitchCommandRouter(handleTwitchCommandUseCase);

			twitchAdapter = new TwitchBotAdapter({
				broadcasterName,
				clientId: env.TWITCH_CLIENT_ID,
				clientSecret: env.TWITCH_CLIENT_SECRET,
				accessToken: env.TWITCH_ACCESS_TOKEN,
				refreshToken: env.TWITCH_REFRESH_TOKEN,
				tokenRepository,
				preferenceRepository,
				handleTwitchEventUseCase,
				commands: twitchCommandRouter.createCommands(),
			});

			return {
				activeDiscordAdapter,
				activeTwitchAdapter: twitchAdapter,
				compositeNotifier,
			};
		},
	);

	const notificationDispatchService = new NotificationDispatchService({
		broadcastNotifier: compositeNotifier,
		channelNotifier: compositeNotifier,
		generationWriteRepository,
		messageThrottle,
	});

	const processJobAttemptUseCase = new ProcessJobAttemptUseCase({
		jobWriteRepository,
		generationWriteRepository,
		preferenceRepository,
		imageGenerator: generationEngine,
	});

	const dispatchSuccessNotificationsUseCase = new DispatchSuccessNotificationsUseCase({
		notificationDispatchService,
	});

	const dispatchFailureNotificationsUseCase = new DispatchFailureNotificationsUseCase({
		notificationDispatchService,
	});

	const processGenerationJobUseCase = new ProcessGenerationJobUseCase({
		generationWriteRepository,
		processJobAttemptUseCase,
		dispatchSuccessNotificationsUseCase,
		dispatchFailureNotificationsUseCase,
	});

	const worker = new PostgresJobWorker(jobWriteRepository, processGenerationJobUseCase);

	const apiServer = new ApiServer({
		generationQueryRepository,
		jobQueryRepository,
		internalApiBearerToken: env.INTERNAL_API_BEARER_TOKEN,
		port: env.APP_PORT,
	});

	const runtime: Runtime = {
		start: async () => {
			worker.start();
			await activeDiscordAdapter.start();
			await activeTwitchAdapter.start();
			await apiServer.start();
		},
		stop: async () => {
			await worker.stop();
			await apiServer.stop();
			await activeTwitchAdapter.stop();
			await activeDiscordAdapter.stop();
			await dbContext.pool.end();
		},
	};

	logBootstrapEvent('runtime:ready');

	return runtime;
}
