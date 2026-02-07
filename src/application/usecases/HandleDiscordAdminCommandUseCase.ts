import type { EnqueueGenerationUseCase } from './EnqueueGenerationUseCase';
import type { GenerationJobPayload } from '../../domain/types';

interface HandleDiscordAdminCommandDeps {
	enqueueGenerationUseCase: EnqueueGenerationUseCase;
	broadcasterName: string;
}

export class HandleDiscordAdminCommandUseCase {
	constructor(private readonly deps: HandleDiscordAdminCommandDeps) {}

	async enqueueGenerateImageRequest(args: {
		discordChannelId: string;
		targetUser: string;
	}): Promise<string> {
		const payload: GenerationJobPayload = {
			kind: 'custom_discord',
			broadcasterName: this.deps.broadcasterName,
			targetUserName: args.targetUser.toLowerCase(),
			targetDisplayName: args.targetUser,
			trigger: 'custom',
			discordMessageChannelId: args.discordChannelId,
			metadata: {
				source: 'discord',
				channel: this.deps.broadcasterName,
				target: args.targetUser,
				trigger: 'custom',
			},
		};

		return this.deps.enqueueGenerationUseCase.enqueue(payload, {
			source: 'discord',
			trigger: 'custom',
			payload: {
				targetUser: args.targetUser,
				discordChannelId: args.discordChannelId,
			},
			targetUserName: args.targetUser.toLowerCase(),
			targetDisplayName: args.targetUser,
			broadcasterName: this.deps.broadcasterName,
		});
	}
}
