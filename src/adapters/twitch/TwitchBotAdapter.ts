import { Bot } from '@twurple/easy-bot';
import { InvalidTokenError, RefreshingAuthProvider, type AccessToken } from '@twurple/auth';
import type { BotCommand } from '@twurple/easy-bot';
import type {
	BroadcastNotifierContract,
	PreferenceRepositoryContract,
	TokenRepositoryContract,
} from '../../application/contracts';
import type { HandleTwitchEventUseCase } from '../../application/usecases/HandleTwitchEventUseCase';

interface TwitchBotAdapterDeps {
	broadcasterName: string;
	clientId: string;
	clientSecret: string;
	accessToken: string;
	refreshToken: string;
	tokenRepository: TokenRepositoryContract;
	preferenceRepository: PreferenceRepositoryContract;
	handleTwitchEventUseCase: HandleTwitchEventUseCase;
	commands: BotCommand[];
}

export class TwitchBotAdapter implements BroadcastNotifierContract {
	private bot: Bot | null = null;

	constructor(private readonly deps: TwitchBotAdapterDeps) {}

	async start(): Promise<void> {
		let tokenData: AccessToken = {
			accessToken: this.deps.accessToken,
			refreshToken: this.deps.refreshToken,
			expiresIn: 0,
			obtainmentTimestamp: 0,
			scope: ['chat:edit', 'chat:read'],
		};
		const storedToken = await this.deps.tokenRepository.getLatestToken();
		if (storedToken) {
			tokenData = storedToken;
		}

		const authProvider = new RefreshingAuthProvider({
			clientId: this.deps.clientId,
			clientSecret: this.deps.clientSecret,
		});

		authProvider.onRefresh(async (_userId, newTokenData) => {
			await this.deps.tokenRepository.upsertToken(newTokenData);
			tokenData = newTokenData;
		});
		authProvider.onRefreshFailure((error) => {
			console.log('Error refreshing token', error);
		});

		try {
			await authProvider.addUserForToken(tokenData, ['chat']);
		} catch (error) {
			if (error instanceof InvalidTokenError) {
				throw new Error('Invalid Twitch tokens, please check your environment variables');
			}
			throw error;
		}

		this.bot = new Bot({
			authProvider,
			channel: this.deps.broadcasterName,
			commands: this.deps.commands,
		});

		this.registerEvents(this.bot);
	}

	async stop(): Promise<void> {
		if (!this.bot) {
			return;
		}
		try {
			this.bot.leave(this.deps.broadcasterName);
		} catch {
			// no-op
		}
	}

	async sendTwitch(message: string): Promise<void> {
		if (!this.bot) {
			throw new Error('Twitch bot is not started');
		}
		await this.bot.say(this.deps.broadcasterName, message);
	}

	async sendDiscordBroadcast(_message: string): Promise<void> {
		// Intentionally unsupported here. Discord adapter implements broadcast side.
	}

	private registerEvents(bot: Bot): void {
		bot.onDisconnect((manually, reason) => {
			console.log(`[ERROR] Disconnected from Twitch: ${manually} ${reason?.message ?? ''}`);
		});
		bot.onConnect(() => {
			console.log('Connected to chat server');
		});
		bot.onJoin(({ broadcasterName }) => {
			console.log(`Joined channel ${broadcasterName}`);
		});
		bot.onSub(({ userName, userDisplayName }) => {
			void this.deps.handleTwitchEventUseCase.handleSubscriptionEvent({
				trigger: 'onSub',
				userName,
				userDisplayName,
			});
		});
		bot.onResub(({ userName, userDisplayName }) => {
			void this.deps.handleTwitchEventUseCase.handleSubscriptionEvent({
				trigger: 'onResub',
				userName,
				userDisplayName,
			});
		});
		bot.onGiftPaidUpgrade(({ userName, userDisplayName }) => {
			void this.deps.handleTwitchEventUseCase.handleSubscriptionEvent({
				trigger: 'onGiftPaidUpgrade',
				userName,
				userDisplayName,
			});
		});
		bot.onPrimePaidUpgrade(({ userName, userDisplayName }) => {
			void this.deps.handleTwitchEventUseCase.handleSubscriptionEvent({
				trigger: 'onPrimePaidUpgrade',
				userName,
				userDisplayName,
			});
		});
		bot.onStandardPayForward(({ gifterName, gifterDisplayName }) => {
			void this.deps.handleTwitchEventUseCase.handleSubscriptionEvent({
				trigger: 'onStandardPayForward',
				userName: gifterName,
				userDisplayName: gifterDisplayName,
				isGifting: true,
			});
		});
		bot.onCommunityPayForward(({ gifterName, gifterDisplayName }) => {
			void this.deps.handleTwitchEventUseCase.handleSubscriptionEvent({
				trigger: 'onCommunityPayForward',
				userName: gifterName,
				userDisplayName: gifterDisplayName,
				isGifting: true,
			});
		});
		bot.onCommunitySub(async ({ gifterName, gifterDisplayName }) => {
			if (gifterName && (await this.deps.preferenceRepository.isBannedGifter(gifterName))) {
				console.log(`Gifter ${gifterName} is banned for ${this.deps.broadcasterName}, not generating image`);
				return;
			}
			await this.deps.handleTwitchEventUseCase.handleSubscriptionEvent({
				trigger: 'onCommunitySub',
				userName: gifterName || 'Anonymous',
				userDisplayName: gifterDisplayName || 'Anonymous',
				isGifting: true,
			});
		});
		bot.onSubGift(async ({ userName, userDisplayName, gifterName }) => {
			if (!gifterName || (await this.deps.preferenceRepository.isBannedGifter(gifterName))) {
				console.log(`Gifter ${gifterName || 'anonymous'} is banned for ${this.deps.broadcasterName}, not generating image`);
				return;
			}
			await this.deps.handleTwitchEventUseCase.handleSubscriptionEvent({
				trigger: 'onSubGift',
				userName,
				userDisplayName,
			});
		});
	}
}
