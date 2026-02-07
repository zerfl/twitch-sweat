import { describe, expect, it, vi } from 'vitest';
import type { StoredJob } from '../../src/application/contracts';
import { ProcessGenerationJobUseCase } from '../../src/application/usecases/ProcessGenerationJobUseCase';

function buildJob(attemptCount: number, maxRetries: number): StoredJob {
	return {
		id: 'job-1',
		status: 'processing',
		attemptCount,
		maxRetries,
		priority: 100,
		nextRunAt: new Date(),
		payload: {
			kind: 'custom_twitch',
			broadcasterName: 'streamer',
			targetUserName: 'minecraft',
			targetDisplayName: 'Minecraft',
			trigger: 'custom',
			requestUserName: 'admin',
		},
		lastError: null,
		lockedAt: new Date(),
		createdAt: new Date(),
		updatedAt: new Date(),
	};
}

describe('ProcessGenerationJobUseCase', () => {
	it('returns success and appends completion audit', async () => {
		const generationWriteRepository = {
			appendAudit: vi.fn(async () => undefined),
		};
		const processJobAttemptUseCase = {
			execute: vi.fn(async () => ({
				status: 'succeeded' as const,
				imageUrl: 'https://imagedelivery.net/example/id/public',
				publicImageUrl: 'https://cdn.example/id.png',
				attemptNumber: 1,
			})),
		};
		const dispatchSuccessNotificationsUseCase = {
			execute: vi.fn(async () => undefined),
		};
		const dispatchFailureNotificationsUseCase = {
			execute: vi.fn(async () => undefined),
		};

		const useCase = new ProcessGenerationJobUseCase({
			generationWriteRepository: generationWriteRepository as never,
			processJobAttemptUseCase: processJobAttemptUseCase as never,
			dispatchSuccessNotificationsUseCase: dispatchSuccessNotificationsUseCase as never,
			dispatchFailureNotificationsUseCase: dispatchFailureNotificationsUseCase as never,
		});

		const result = await useCase.process(buildJob(0, 3));

		expect(result).toEqual({ success: true });
		expect(dispatchSuccessNotificationsUseCase.execute).toHaveBeenCalledTimes(1);
		expect(dispatchSuccessNotificationsUseCase.execute).toHaveBeenCalledWith(expect.anything(), 'https://cdn.example/id.png');
		expect(dispatchFailureNotificationsUseCase.execute).not.toHaveBeenCalled();
		expect(generationWriteRepository.appendAudit).toHaveBeenCalledWith(
			'job-1',
			expect.objectContaining({ step: 'job.completed', level: 'info' }),
		);
	});

	it('schedules retry and appends retry audit when retries remain', async () => {
		const generationWriteRepository = {
			appendAudit: vi.fn(async () => undefined),
		};
		const processJobAttemptUseCase = {
			execute: vi.fn(async () => ({ status: 'failed' as const, errorMessage: 'temporary', attemptNumber: 1 })),
		};
		const dispatchSuccessNotificationsUseCase = {
			execute: vi.fn(async () => undefined),
		};
		const dispatchFailureNotificationsUseCase = {
			execute: vi.fn(async () => undefined),
		};

		const useCase = new ProcessGenerationJobUseCase({
			generationWriteRepository: generationWriteRepository as never,
			processJobAttemptUseCase: processJobAttemptUseCase as never,
			dispatchSuccessNotificationsUseCase: dispatchSuccessNotificationsUseCase as never,
			dispatchFailureNotificationsUseCase: dispatchFailureNotificationsUseCase as never,
		});

		const result = await useCase.process(buildJob(0, 3));

		expect(result).toEqual({ success: false, retryable: true, errorMessage: 'temporary' });
		expect(dispatchFailureNotificationsUseCase.execute).not.toHaveBeenCalled();
		expect(generationWriteRepository.appendAudit).toHaveBeenCalledWith(
			'job-1',
			expect.objectContaining({
				step: 'job.retry.scheduled',
				level: 'warn',
				message: 'Scheduling retry attempt 2 after attempt 1 failed',
				metadata: expect.objectContaining({ nextAttempt: 2, attemptNumber: 1 }),
			}),
		);
	});

	it('dispatches failure and marks terminal audit when retries are exhausted', async () => {
		const generationWriteRepository = {
			appendAudit: vi.fn(async () => undefined),
		};
		const processJobAttemptUseCase = {
			execute: vi.fn(async () => ({ status: 'failed' as const, errorMessage: 'fatal', attemptNumber: 4 })),
		};
		const dispatchSuccessNotificationsUseCase = {
			execute: vi.fn(async () => undefined),
		};
		const dispatchFailureNotificationsUseCase = {
			execute: vi.fn(async () => undefined),
		};

		const useCase = new ProcessGenerationJobUseCase({
			generationWriteRepository: generationWriteRepository as never,
			processJobAttemptUseCase: processJobAttemptUseCase as never,
			dispatchSuccessNotificationsUseCase: dispatchSuccessNotificationsUseCase as never,
			dispatchFailureNotificationsUseCase: dispatchFailureNotificationsUseCase as never,
		});

		const result = await useCase.process(buildJob(3, 3));

		expect(result).toEqual({ success: false, retryable: false, errorMessage: 'fatal' });
		expect(dispatchFailureNotificationsUseCase.execute).toHaveBeenCalledTimes(1);
		expect(generationWriteRepository.appendAudit).toHaveBeenCalledWith(
			'job-1',
			expect.objectContaining({ step: 'job.failed', level: 'error' }),
		);
	});
});
