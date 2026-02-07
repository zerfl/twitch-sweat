import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoredJob } from '../../src/application/contracts';
import { PostgresJobWorker } from '../../src/infrastructure/queue/PostgresJobWorker';

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function createJob(id: string): StoredJob {
	return {
		id,
		status: 'pending',
		attemptCount: 0,
		maxRetries: 3,
		priority: 1,
		nextRunAt: new Date(),
		payload: {
			kind: 'subscription',
			broadcasterName: 'streamer',
			targetUserName: 'user',
			targetDisplayName: 'User',
			trigger: 'onSub',
		},
		lastError: null,
		lockedAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

describe('PostgresJobWorker', () => {
	let worker: PostgresJobWorker | null = null;

	afterEach(async () => {
		if (worker) {
			await worker.stop();
		}
		worker = null;
	});

	it('recovers stale jobs on start and marks successful jobs as succeeded', async () => {
		const actions: string[] = [];
		let claimed = false;
		const requeueStaleProcessing = vi.fn(async (_olderThan: Date) => 0);

		worker = new PostgresJobWorker(
			{
				claimNextRunnable: async () => {
					if (claimed) {
						return null;
					}
					claimed = true;
					return createJob('job-1');
				},
				requeueStaleProcessing,
				markSucceeded: async (jobId: string) => {
					actions.push(`succeeded:${jobId}`);
				},
				markFailed: async () => {
					actions.push('failed');
				},
				requeue: async () => {
					actions.push('requeue');
				},
			} as never,
			{
				process: async () => ({ success: true }),
			},
			5,
		);

		const beforeStart = Date.now();
		worker.start();
		await wait(40);
		await worker.stop();

		expect(actions).toEqual(['succeeded:job-1']);
		expect(requeueStaleProcessing).toHaveBeenCalledTimes(1);
		const firstCall = requeueStaleProcessing.mock.calls.at(0);
		expect(firstCall).toBeDefined();
		const staleCutoff = firstCall?.[0];
		expect(staleCutoff).toBeInstanceOf(Date);
		if (!(staleCutoff instanceof Date)) {
			throw new Error('Expected stale cutoff date');
		}
		const ageMs = beforeStart - staleCutoff.getTime();
		expect(ageMs).toBeGreaterThanOrEqual(15 * 60 * 1000 - 3000);
		expect(ageMs).toBeLessThanOrEqual(15 * 60 * 1000 + 3000);
	});

	it('dispatches multiple claimed jobs without waiting for earlier jobs to finish', async () => {
		const actions: string[] = [];
		const processStarted: string[] = [];
		const resolvers = new Map<string, () => void>();
		const claimQueue = [createJob('job-1'), createJob('job-2')];

		worker = new PostgresJobWorker(
			{
				claimNextRunnable: async () => {
					return claimQueue.shift() ?? null;
				},
				requeueStaleProcessing: async () => 0,
				markSucceeded: async (jobId: string) => {
					actions.push(`succeeded:${jobId}`);
				},
				markFailed: async () => {
					actions.push('failed');
				},
				requeue: async () => {
					actions.push('requeue');
				},
			} as never,
			{
				process: async (job) => {
					processStarted.push(job.id);
					return await new Promise<{ success: true }>((resolve) => {
						resolvers.set(job.id, () => resolve({ success: true }));
					});
				},
			},
			5,
		);

		worker.start();
		await wait(20);
		expect(processStarted).toEqual(['job-1', 'job-2']);

		resolvers.get('job-1')?.();
		resolvers.get('job-2')?.();
		await wait(20);
		await worker.stop();

		expect(actions).toEqual(expect.arrayContaining(['succeeded:job-1', 'succeeded:job-2']));
	});

	it('requeues retryable failures', async () => {
		const actions: string[] = [];
		let claimed = false;

		worker = new PostgresJobWorker(
			{
				claimNextRunnable: async () => {
					if (claimed) {
						return null;
					}
					claimed = true;
					return createJob('job-2');
				},
				requeueStaleProcessing: async () => 0,
				markSucceeded: async () => {
					actions.push('succeeded');
				},
				markFailed: async () => {
					actions.push('failed');
				},
				requeue: async (jobId: string) => {
					actions.push(`requeue:${jobId}`);
				},
			} as never,
			{
				process: async () => ({ success: false, retryable: true, errorMessage: 'temporary' }),
			},
			5,
		);

		worker.start();
		await wait(40);
		await worker.stop();

		expect(actions).toEqual(['requeue:job-2']);
	});

	it('handles processor throws and continues with subsequent jobs', async () => {
		const actions: string[] = [];
		const claimQueue = [createJob('job-throw'), createJob('job-ok')];

		worker = new PostgresJobWorker(
			{
				claimNextRunnable: async () => {
					return claimQueue.shift() ?? null;
				},
				requeueStaleProcessing: async () => 0,
				markSucceeded: async (jobId: string) => {
					actions.push(`succeeded:${jobId}`);
				},
				markFailed: async (jobId: string) => {
					actions.push(`failed:${jobId}`);
				},
				requeue: async () => {
					actions.push('requeue');
				},
			} as never,
			{
				process: async (job) => {
					if (job.id === 'job-throw') {
						throw new Error('boom');
					}
					return { success: true };
				},
			},
			5,
		);

		worker.start();
		await wait(60);
		await worker.stop();

		expect(actions).toEqual(['failed:job-throw', 'succeeded:job-ok']);
	});
});
