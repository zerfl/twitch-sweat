import { setTimeout as sleep } from 'timers/promises';
import type { JobWriteRepositoryContract, StoredJob } from '../../application/contracts';

export interface JobProcessor {
	process(job: StoredJob): Promise<{ success: true } | { success: false; retryable: boolean; errorMessage: string }>;
}

export class PostgresJobWorker {
	private static readonly STALE_LOCK_AGE_MS = 15 * 60 * 1000;
	private running = false;
	private loopPromise: Promise<void> | null = null;
	private readonly inFlightJobs = new Set<Promise<void>>();

	constructor(
		private readonly jobWriteRepository: JobWriteRepositoryContract,
		private readonly processor: JobProcessor,
		private readonly pollingIntervalMs: number = 750,
	) {}

	start(): void {
		if (this.running) {
			return;
		}
		this.running = true;
		this.loopPromise = this.loop();
	}

	async stop(): Promise<void> {
		this.running = false;
		if (this.loopPromise) {
			await this.loopPromise;
		}
	}

	private async loop(): Promise<void> {
		await this.recoverStaleProcessingJobs();
		while (this.running) {
			try {
				const job = await this.jobWriteRepository.claimNextRunnable();
				if (!job) {
					await sleep(this.pollingIntervalMs);
					continue;
				}

				this.track(this.processClaimedJob(job));
			} catch (error) {
				console.error('Job worker loop iteration failed', error);
				await sleep(this.pollingIntervalMs);
			}
		}
		await Promise.allSettled(Array.from(this.inFlightJobs));
	}

	private async recoverStaleProcessingJobs(): Promise<void> {
		try {
			const staleBefore = new Date(Date.now() - PostgresJobWorker.STALE_LOCK_AGE_MS);
			const recoveredCount = await this.jobWriteRepository.requeueStaleProcessing(staleBefore);
			if (recoveredCount > 0) {
				console.log(`Recovered ${recoveredCount} stale processing job lock(s)`);
			}
		} catch (error) {
			console.error('Failed to recover stale processing jobs', error);
		}
	}

	private track(jobPromise: Promise<void>): void {
		this.inFlightJobs.add(jobPromise);
		void jobPromise.finally(() => {
			this.inFlightJobs.delete(jobPromise);
		});
	}

	private async processClaimedJob(job: StoredJob): Promise<void> {
		try {
			const result = await this.processor.process(job);
			if (result.success) {
				await this.jobWriteRepository.markSucceeded(job.id);
				return;
			}

			if (!result.retryable) {
				await this.jobWriteRepository.markFailed(job.id, result.errorMessage);
				return;
			}

			await this.jobWriteRepository.requeue(job.id, result.errorMessage, new Date());
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`Unexpected job processor error for ${job.id}: ${message}`);
			await this.jobWriteRepository.markFailed(job.id, message);
		}
	}
}
