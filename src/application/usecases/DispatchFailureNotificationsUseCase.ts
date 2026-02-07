import type { StoredJob } from '../contracts';
import {
	customDiscordFailure,
	customTwitchFailure,
	subscriptionFailure,
} from '../../domain/policies/MessageTemplatePolicy';
import { NotificationDispatchService } from '../services/NotificationDispatchService';

interface DispatchFailureDeps {
	notificationDispatchService: NotificationDispatchService;
}

export class DispatchFailureNotificationsUseCase {
	constructor(private readonly deps: DispatchFailureDeps) {}

	async execute(job: StoredJob): Promise<void> {
		const payload = job.payload;
		if (payload.kind === 'subscription') {
			await this.deps.notificationDispatchService.sendTwitchBroadcast(
				job.id,
				subscriptionFailure(payload.targetUserName, Boolean(payload.isGifting)),
			);
			return;
		}

		if (payload.kind === 'custom_twitch' && payload.requestUserName) {
			await this.deps.notificationDispatchService.sendTwitchBroadcast(job.id, customTwitchFailure(payload.requestUserName));
			return;
		}

		if (payload.kind === 'custom_discord' && payload.discordMessageChannelId) {
			await this.deps.notificationDispatchService.sendDiscordChannel(
				job.id,
				payload.discordMessageChannelId,
				customDiscordFailure(payload.targetDisplayName),
			);
		}
	}
}
