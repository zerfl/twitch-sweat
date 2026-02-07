import type {
	GenerationWriteRepositoryContract,
	StoredJob,
} from '../contracts';
import { evaluateRetry } from '../../domain/policies/RetryPolicy';
import { DispatchFailureNotificationsUseCase } from './DispatchFailureNotificationsUseCase';
import { DispatchSuccessNotificationsUseCase } from './DispatchSuccessNotificationsUseCase';
import { ProcessJobAttemptUseCase } from './ProcessJobAttemptUseCase';

interface ProcessGenerationJobDeps {
	generationWriteRepository: GenerationWriteRepositoryContract;
	processJobAttemptUseCase: ProcessJobAttemptUseCase;
	dispatchSuccessNotificationsUseCase: DispatchSuccessNotificationsUseCase;
	dispatchFailureNotificationsUseCase: DispatchFailureNotificationsUseCase;
}

export class ProcessGenerationJobUseCase {
	constructor(private readonly deps: ProcessGenerationJobDeps) {}

	async process(job: StoredJob): Promise<{ success: true } | { success: false; retryable: boolean; errorMessage: string }> {
		await this.deps.generationWriteRepository.appendAudit(job.id, {
			step: 'job.start',
			level: 'info',
			message: `Starting job attempt ${job.attemptCount + 1}`,
			metadata: { kind: job.payload.kind },
		});

		const attemptResult = await this.deps.processJobAttemptUseCase.execute(job);
		if (attemptResult.status === 'succeeded') {
			await this.deps.dispatchSuccessNotificationsUseCase.execute(job, attemptResult.publicImageUrl);
			await this.deps.generationWriteRepository.appendAudit(job.id, {
				step: 'job.completed',
				level: 'info',
				message: 'Job completed successfully',
			});
			return { success: true };
		}

		await this.deps.generationWriteRepository.appendAudit(job.id, {
			step: 'job.generation.failed',
			level: 'warn',
			message: attemptResult.errorMessage,
		});

		const retryDecision = evaluateRetry(job.attemptCount, job.maxRetries);
		if (retryDecision.shouldRetry) {
			const nextAttempt = attemptResult.attemptNumber + 1;
			await this.deps.generationWriteRepository.appendAudit(job.id, {
				step: 'job.retry.scheduled',
				level: 'warn',
				message: `Scheduling retry attempt ${nextAttempt} after attempt ${attemptResult.attemptNumber} failed`,
				metadata: {
					maxRetries: job.maxRetries,
					currentAttemptCount: job.attemptCount,
					attemptNumber: attemptResult.attemptNumber,
					nextAttempt,
					errorMessage: attemptResult.errorMessage,
				},
			});
			return { success: false, retryable: true, errorMessage: attemptResult.errorMessage };
		}

		await this.deps.generationWriteRepository.appendAudit(job.id, {
			step: 'job.failed',
			level: 'error',
			message: `No retries left after attempt ${attemptResult.attemptNumber}`,
			metadata: {
				maxRetries: job.maxRetries,
				currentAttemptCount: job.attemptCount,
				attemptNumber: attemptResult.attemptNumber,
				errorMessage: attemptResult.errorMessage,
			},
		});
		await this.deps.dispatchFailureNotificationsUseCase.execute(job);
		return { success: false, retryable: false, errorMessage: attemptResult.errorMessage };
	}
}
