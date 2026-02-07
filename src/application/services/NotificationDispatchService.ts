import type {
	BroadcastNotifierContract,
	ChannelNotifierContract,
	GenerationWriteRepositoryContract,
	MessageThrottleContract,
} from '../contracts';

interface NotificationDispatchServiceDeps {
	broadcastNotifier: BroadcastNotifierContract;
	channelNotifier: ChannelNotifierContract;
	generationWriteRepository: GenerationWriteRepositoryContract;
	messageThrottle: MessageThrottleContract;
}

export class NotificationDispatchService {
	constructor(private readonly deps: NotificationDispatchServiceDeps) {}

	async sendTwitchBroadcast(jobId: string, message: string): Promise<void> {
		await this.deps.messageThrottle.run(async () => {
			try {
				await this.deps.broadcastNotifier.sendTwitch(message);
				await this.deps.generationWriteRepository.recordOutboundMessage({
					jobId,
					platform: 'twitch',
					target: 'broadcast',
					payload: { message },
					success: true,
				});
			} catch (error) {
				await this.deps.generationWriteRepository.recordOutboundMessage({
					jobId,
					platform: 'twitch',
					target: 'broadcast',
					payload: { message },
					success: false,
					errorMessage: error instanceof Error ? error.message : String(error),
				});
			}
		});
	}

	async sendDiscordBroadcast(jobId: string, message: string): Promise<void> {
		await this.deps.messageThrottle.run(async () => {
			try {
				await this.deps.broadcastNotifier.sendDiscordBroadcast(message);
				await this.deps.generationWriteRepository.recordOutboundMessage({
					jobId,
					platform: 'discord',
					target: 'all_channels',
					payload: { message },
					success: true,
				});
			} catch (error) {
				await this.deps.generationWriteRepository.recordOutboundMessage({
					jobId,
					platform: 'discord',
					target: 'all_channels',
					payload: { message },
					success: false,
					errorMessage: error instanceof Error ? error.message : String(error),
				});
			}
		});
	}

	async sendDiscordChannel(jobId: string, channelId: string, message: string): Promise<void> {
		await this.deps.messageThrottle.run(async () => {
			try {
				await this.deps.channelNotifier.sendDiscordChannel(channelId, message);
				await this.deps.generationWriteRepository.recordOutboundMessage({
					jobId,
					platform: 'discord',
					target: channelId,
					payload: { message },
					success: true,
				});
			} catch (error) {
				await this.deps.generationWriteRepository.recordOutboundMessage({
					jobId,
					platform: 'discord',
					target: channelId,
					payload: { message },
					success: false,
					errorMessage: error instanceof Error ? error.message : String(error),
				});
			}
		});
	}
}
