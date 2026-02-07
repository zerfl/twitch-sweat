import type { StoredJob } from '../contracts';
import {
	customDiscordSuccessBroadcast,
	customTwitchSuccessDiscord,
	customTwitchSuccessTwitch,
	subscriptionSuccessDiscord,
	subscriptionSuccessTwitch,
	testGenerationSuccess,
	testGenerationSuccessDiscord,
} from '../../domain/policies/MessageTemplatePolicy';
import { NotificationDispatchService } from '../services/NotificationDispatchService';

interface DispatchSuccessDeps {
	notificationDispatchService: NotificationDispatchService;
}

export class DispatchSuccessNotificationsUseCase {
	constructor(private readonly deps: DispatchSuccessDeps) {}

	async execute(job: StoredJob, publicImageUrl: string): Promise<void> {
		const payload = job.payload;

		if (payload.kind === 'subscription') {
			await Promise.all([
				this.deps.notificationDispatchService.sendDiscordBroadcast(
					job.id,
					subscriptionSuccessDiscord(payload.targetUserName, Boolean(payload.isGifting), publicImageUrl),
				),
				this.deps.notificationDispatchService.sendTwitchBroadcast(
					job.id,
					subscriptionSuccessTwitch(payload.targetUserName, Boolean(payload.isGifting), publicImageUrl),
				),
			]);
			return;
		}

		if (payload.kind === 'custom_twitch' && payload.requestUserName) {
			await Promise.all([
				this.deps.notificationDispatchService.sendDiscordBroadcast(
					job.id,
					customTwitchSuccessDiscord(payload.requestUserName, payload.targetDisplayName, publicImageUrl),
				),
				this.deps.notificationDispatchService.sendTwitchBroadcast(
					job.id,
					customTwitchSuccessTwitch(payload.requestUserName, payload.targetDisplayName, publicImageUrl),
				),
			]);
			return;
		}

		if (payload.kind === 'custom_discord') {
			await this.deps.notificationDispatchService.sendDiscordBroadcast(
				job.id,
				customDiscordSuccessBroadcast(payload.targetDisplayName, publicImageUrl),
			);
			return;
		}

		if (payload.kind === 'test_generation' && payload.requestUserName) {
			const styleKeyword = payload.style ?? 'unknown';
			await Promise.all([
				this.deps.notificationDispatchService.sendTwitchBroadcast(
					job.id,
					testGenerationSuccess(payload.requestUserName, styleKeyword, publicImageUrl),
				),
				this.deps.notificationDispatchService.sendDiscordBroadcast(
					job.id,
					testGenerationSuccessDiscord(payload.targetDisplayName, styleKeyword, publicImageUrl),
				),
			]);
		}
	}
}
