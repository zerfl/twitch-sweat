import { getVerbFromTrigger } from '../domain/triggerRouting';
import type { GenerationJobPayload } from '../domain/types';
import { evaluateRetry } from '../domain/retryPolicy';
import type { JobRepository, StoredJob } from '../infrastructure/repositories/JobRepository';
import type { GenerationRepository } from '../infrastructure/repositories/GenerationRepository';
import type { PreferenceRepository } from '../infrastructure/repositories/PreferenceRepository';
import type { ProviderLimiter } from '../infrastructure/throttle/providerLimiter';
import type { DiscordNotifier, TwitchNotifier } from './Notifier';
import type { GenerationEngine } from './GenerationEngine';

interface ProcessGenerationJobDeps {
	jobRepository: JobRepository;
	generationRepository: GenerationRepository;
	preferenceRepository: PreferenceRepository;
	generationEngine: GenerationEngine;
	twitchNotifier: TwitchNotifier;
	discordNotifier: DiscordNotifier;
	limiter: ProviderLimiter;
	maxRetries: number;
}

export class ProcessGenerationJobUseCase {
	constructor(private readonly deps: ProcessGenerationJobDeps) {}

	async process(job: StoredJob): Promise<{ success: true } | { success: false; retryable: boolean; errorMessage: string }> {
		const payload = job.payload;
		const attemptNumber = job.attemptCount + 1;
		await this.deps.jobRepository.incrementAttempt(job.id);
		const attemptId = await this.deps.generationRepository.createAttempt(job.id, attemptNumber);
		await this.deps.generationRepository.appendAudit(job.id, {
			step: 'job.start',
			level: 'info',
			message: `Starting job attempt ${attemptNumber}`,
			metadata: { kind: payload.kind },
		});

		try {
			const theme = await this.deps.preferenceRepository.getTheme();
			const result = await this.deps.generationEngine.generate({
				userName: payload.targetUserName,
				userDisplayName: payload.targetDisplayName,
				theme,
				style: payload.style ?? null,
				attempt: attemptNumber,
				metadata: payload.metadata ?? {},
				getMeaning: (userName) => this.deps.preferenceRepository.getMeaning(userName),
				onProviderCall: (providerCall) => this.deps.generationRepository.recordProviderCall(job.id, attemptId, providerCall),
			});

			if (!result.success) {
				await this.deps.generationRepository.completeAttempt(attemptId, 'failed', result.message);
				await this.deps.generationRepository.appendAudit(job.id, {
					step: 'job.generation.failed',
					level: 'warn',
					message: result.message,
				});

				const retryDecision = evaluateRetry(job.attemptCount, job.maxRetries);
				if (!retryDecision.shouldRetry) {
					await this.notifyFailure(job.id, payload);
					return { success: false, retryable: false, errorMessage: result.message };
				}

				return { success: false, retryable: true, errorMessage: result.message };
			}

			await this.deps.generationRepository.saveOutput(job.id, {
				broadcasterName: payload.broadcasterName,
				targetUserName: payload.targetUserName,
				targetDisplayName: payload.targetDisplayName,
				theme: theme ?? '',
				result,
			});

			await this.notifySuccess(job.id, payload, result.imageUrl);
			await this.deps.generationRepository.completeAttempt(attemptId, 'succeeded');
			await this.deps.generationRepository.appendAudit(job.id, {
				step: 'job.completed',
				level: 'info',
				message: 'Job completed successfully',
			});

			return { success: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await this.deps.generationRepository.completeAttempt(attemptId, 'failed', message);
			await this.deps.generationRepository.appendAudit(job.id, {
				step: 'job.exception',
				level: 'error',
				message,
			});

			const retryDecision = evaluateRetry(job.attemptCount, job.maxRetries);
			if (!retryDecision.shouldRetry) {
				await this.notifyFailure(job.id, payload);
				return { success: false, retryable: false, errorMessage: message };
			}

			return { success: false, retryable: true, errorMessage: message };
		}
	}

	private async notifyFailure(jobId: string, payload: GenerationJobPayload): Promise<void> {
		if (payload.kind === 'subscription') {
			const verb = payload.isGifting ? getVerbFromTrigger({ isGifting: true }) : getVerbFromTrigger({});
			const twitchMessage = `Thank you @${payload.targetUserName} for ${verb} dnkLove Unfortunately, I was unable to generate an image for you.`;
			await this.throttledTwitchSend(jobId, twitchMessage);
		}
		if (payload.kind === 'custom_twitch' && payload.requestUserName) {
			const twitchMessage = `Sorry, ${payload.requestUserName}, I was unable to generate an image for you.`;
			await this.throttledTwitchSend(jobId, twitchMessage);
		}
		if (payload.kind === 'custom_discord' && payload.discordMessageChannelId) {
			const discordMessage = `Unable to generate image for ${payload.targetDisplayName}`;
			await this.throttledDiscordSendToChannel(jobId, payload.discordMessageChannelId, discordMessage);
		}
	}

	private async notifySuccess(jobId: string, payload: GenerationJobPayload, imageUrl: string): Promise<void> {
		if (payload.kind === 'subscription') {
			const verb = payload.isGifting ? getVerbFromTrigger({ isGifting: true }) : getVerbFromTrigger({});
			const discordMessage = `Thank you \`${payload.targetUserName}\` for ${verb}. Here's your sweatling: ${imageUrl}`;
			const twitchMessage = `Thank you @${payload.targetUserName} for ${verb} dnkLove This is for you: ${imageUrl}`;
			await Promise.all([
				this.throttledDiscordSendToAll(jobId, discordMessage),
				this.throttledTwitchSend(jobId, twitchMessage),
			]);
			return;
		}

		if (payload.kind === 'custom_twitch' && payload.requestUserName) {
			const discordMessage = `@${payload.requestUserName} requested generation for \`${payload.targetDisplayName}\`. Here's the sweatling: ${imageUrl}`;
			const twitchMessage = `@${payload.requestUserName} requested generation for @${payload.targetDisplayName}. Here's the sweatling: ${imageUrl}`;
			await Promise.all([
				this.throttledDiscordSendToAll(jobId, discordMessage),
				this.throttledTwitchSend(jobId, twitchMessage),
			]);
			return;
		}

		if (payload.kind === 'custom_discord') {
			const discordMessage = `Thank you \`${payload.targetDisplayName}\` for subscribing. Here's your sweatling: ${imageUrl}`;
			await this.throttledDiscordSendToAll(jobId, discordMessage);
			if (payload.discordMessageChannelId) {
				await this.throttledDiscordSendToChannel(
					jobId,
					payload.discordMessageChannelId,
					`Generated image for ${payload.targetDisplayName}: ${imageUrl}`,
				);
			}
			return;
		}

		if (payload.kind === 'test_generation' && payload.requestUserName) {
			const twitchMessage = `@${payload.requestUserName} Test image for style ${payload.style ?? 'unknown'}: ${imageUrl}`;
			const discordMessage = `Test image for \`${payload.targetDisplayName}\` using style ${payload.style ?? 'unknown'}: ${imageUrl}`;
			await Promise.all([
				this.throttledTwitchSend(jobId, twitchMessage),
				this.throttledDiscordSendToAll(jobId, discordMessage),
			]);
		}
	}

	private async throttledTwitchSend(jobId: string, message: string): Promise<void> {
		await this.deps.limiter.message(async () => {
			try {
				await this.deps.twitchNotifier.say(message);
				await this.deps.generationRepository.recordOutboundMessage({
					jobId,
					platform: 'twitch',
					target: 'broadcast',
					payload: { message },
					success: true,
				});
			} catch (error) {
				await this.deps.generationRepository.recordOutboundMessage({
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

	private async throttledDiscordSendToAll(jobId: string, message: string): Promise<void> {
		await this.deps.limiter.message(async () => {
			try {
				await this.deps.discordNotifier.sendToAllChannels(message);
				await this.deps.generationRepository.recordOutboundMessage({
					jobId,
					platform: 'discord',
					target: 'all_channels',
					payload: { message },
					success: true,
				});
			} catch (error) {
				await this.deps.generationRepository.recordOutboundMessage({
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

	private async throttledDiscordSendToChannel(jobId: string, channelId: string, message: string): Promise<void> {
		await this.deps.limiter.message(async () => {
			try {
				await this.deps.discordNotifier.sendToChannel(channelId, message);
				await this.deps.generationRepository.recordOutboundMessage({
					jobId,
					platform: 'discord',
					target: channelId,
					payload: { message },
					success: true,
				});
			} catch (error) {
				await this.deps.generationRepository.recordOutboundMessage({
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
