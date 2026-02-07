import type { EnqueueGenerationUseCase } from './EnqueueGenerationUseCase';
import type { GenerationWriteRepositoryContract, PreferenceRepositoryContract } from '../contracts';
import type { GenerationJobPayload } from '../../domain/types';

interface HandleTwitchEventDeps {
	enqueueGenerationUseCase: EnqueueGenerationUseCase;
	preferenceRepository: PreferenceRepositoryContract;
	generationWriteRepository: GenerationWriteRepositoryContract;
	broadcasterName: string;
}

interface SubscriptionEventInput {
	userName: string;
	userDisplayName: string;
	isGifting?: boolean;
	trigger: string;
}

export class HandleTwitchEventUseCase {
	constructor(private readonly deps: HandleTwitchEventDeps) {}

	async handleSubscriptionEvent(input: SubscriptionEventInput): Promise<void> {
		const userName = input.userName.toLowerCase();
		if (await this.deps.preferenceRepository.isUserIgnored(userName)) {
			await this.deps.generationWriteRepository.appendAudit(null, {
				step: 'event.skipped.ignored-user',
				level: 'info',
				message: `Skipped ignored user ${userName}`,
			});
			return;
		}

		const payload: GenerationJobPayload = {
			kind: 'subscription',
			broadcasterName: this.deps.broadcasterName,
			targetUserName: userName,
			targetDisplayName: input.userDisplayName,
			trigger: input.trigger,
			...(input.isGifting ? { isGifting: true } : {}),
			metadata: {
				source: 'twitch',
				channel: this.deps.broadcasterName,
				target: userName,
				trigger: input.isGifting ? 'gifting' : 'subscribing',
			},
		};

		await this.deps.enqueueGenerationUseCase.enqueue(payload, {
			source: 'twitch',
			trigger: input.trigger,
			payload: {
				userName,
				userDisplayName: input.userDisplayName,
				isGifting: Boolean(input.isGifting),
			},
			targetUserName: userName,
			targetDisplayName: input.userDisplayName,
			broadcasterName: this.deps.broadcasterName,
		});
	}

	async handleCustomGenerationRequest(requestUserName: string, target: string, style: string | null): Promise<void> {
		const targetUserName = target.toLowerCase();
		if (await this.deps.preferenceRepository.isUserIgnored(targetUserName)) {
			return;
		}
		const payload: GenerationJobPayload = {
			kind: 'custom_twitch',
			broadcasterName: this.deps.broadcasterName,
			targetUserName,
			targetDisplayName: target,
			trigger: 'custom',
			requestUserName,
			style,
			metadata: {
				source: 'twitch',
				channel: this.deps.broadcasterName,
				target,
				trigger: 'custom',
			},
		};
		await this.deps.enqueueGenerationUseCase.enqueue(payload, {
			source: 'twitch',
			trigger: 'custom',
			payload: {
				requestUserName,
				target,
				style,
			},
			targetUserName: targetUserName,
			targetDisplayName: target,
			broadcasterName: this.deps.broadcasterName,
		});
	}
}
