import {
	discordAnnouncing,
	discordGenerateQueued,
	discordNeedAnnouncement,
	discordNeedGenerateTargets,
	discordUnknownCommand,
} from '../../domain/policies/MessageTemplatePolicy';
import type { HandleDiscordAdminCommandUseCase } from '../../application/usecases/HandleDiscordAdminCommandUseCase';

interface DiscordAdminCommandRouterDeps {
	handleDiscordAdminCommandUseCase: HandleDiscordAdminCommandUseCase;
	sendBroadcast: (message: string) => Promise<void>;
}

export class DiscordAdminCommandRouter {
	constructor(private readonly deps: DiscordAdminCommandRouterDeps) {}

	async handleMessage(content: string, channelId: string, reply: (message: string) => Promise<void>): Promise<void> {
		const [command, ...params] = content.split(' ');
		if (command === '!announce') {
			const announcement = params.join(' ');
			if (!announcement) {
				await reply(discordNeedAnnouncement);
				return;
			}
			await reply(discordAnnouncing(announcement));
			await this.deps.sendBroadcast(announcement);
			return;
		}

		if (command === '!generateimage') {
			if (params.length === 0) {
				await reply(discordNeedGenerateTargets);
				return;
			}
			for (const targetUser of params) {
				await this.deps.handleDiscordAdminCommandUseCase.enqueueGenerateImageRequest({
					discordChannelId: channelId,
					targetUser,
				});
			}
			await reply(discordGenerateQueued(params.length));
			return;
		}

		await reply(discordUnknownCommand);
	}
}
