import type { JobWriteRepositoryContract, StoredJob } from '../contracts';
import { evaluateRetry } from '../../domain/policies/RetryPolicy';

interface FinalizeJobStateDeps {
	jobWriteRepository: JobWriteRepositoryContract;
}

export type FinalizeJobStateResult =
	| { finalState: 'succeeded' }
	| { finalState: 'requeued' }
	| { finalState: 'failed' };

export class FinalizeJobStateUseCase {
	constructor(private readonly deps: FinalizeJobStateDeps) {}

	async finalizeSuccess(job: StoredJob): Promise<FinalizeJobStateResult> {
		await this.deps.jobWriteRepository.markSucceeded(job.id);
		return { finalState: 'succeeded' };
	}

	async finalizeFailure(job: StoredJob, errorMessage: string): Promise<FinalizeJobStateResult> {
		const retryDecision = evaluateRetry(job.attemptCount, job.maxRetries);
		if (retryDecision.shouldRetry) {
			await this.deps.jobWriteRepository.requeue(job.id, errorMessage, retryDecision.nextRunAt);
			return { finalState: 'requeued' };
		}
		await this.deps.jobWriteRepository.markFailed(job.id, errorMessage);
		return { finalState: 'failed' };
	}
}
