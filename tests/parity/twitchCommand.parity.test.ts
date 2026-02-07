import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { DALLE_TEMPLATES } from '../../src/constants/styles';
import { HandleTwitchCommandUseCase, type TwitchCommandExecutionContext } from '../../src/application/usecases/HandleTwitchCommandUseCase';
import type { StoredJob } from '../../src/application/contracts';

type Golden = {
	sample: {
		adminUser: string;
		requestUser: string;
		targetUser: string;
		theme: string;
		meaning: string;
		gifter: string;
		style: string;
		imageUrl: string;
	};
	twitchCommands: Record<string, string>;
};

function loadGolden(): Golden {
	const file = new URL('./golden/typed-baseline.json', import.meta.url);
	return JSON.parse(readFileSync(file, 'utf-8')) as Golden;
}

function createFixture() {
	const sayMessages: string[] = [];
	const discordMessages: string[] = [];

	const preferenceRepository = {
		isUserIgnored: vi.fn(async () => false),
		addIgnoredUser: vi.fn(async () => undefined),
		removeIgnoredUser: vi.fn(async () => undefined),
		setTheme: vi.fn(async () => undefined),
		removeTheme: vi.fn(async () => true),
		getTheme: vi.fn(async () => undefined as string | undefined),
		setMeaning: vi.fn(async () => undefined),
		removeMeaning: vi.fn(async () => false),
		getMeaning: vi.fn(async (userName: string) => userName),
		addBannedGifter: vi.fn(async () => undefined),
		removeBannedGifter: vi.fn(async () => false),
		isBannedGifter: vi.fn(async () => false),
	};

	const handleTwitchEventUseCase = {
		handleCustomGenerationRequest: vi.fn(async () => undefined),
	};

	const generationWriteRepository = {
		createEvent: vi.fn(async () => undefined),
		createAttempt: vi.fn(async () => 1),
		completeAttempt: vi.fn(async () => undefined),
		recordProviderCall: vi.fn(async () => undefined),
		saveOutput: vi.fn(async () => undefined),
		recordOutboundMessage: vi.fn(async () => undefined),
		appendAudit: vi.fn(async () => undefined),
	};

	const generationQueryRepository = {
		listGenerations: vi.fn(async () => [] as Array<Record<string, unknown>>),
		getGenerationById: vi.fn(async () => null),
		listEvents: vi.fn(async () => [] as Array<Record<string, unknown>>),
		listProviderCalls: vi.fn(async () => [] as Array<Record<string, unknown>>),
		listAudit: vi.fn(async () => [] as Array<Record<string, unknown>>),
		getTopTriggersSince: vi.fn(async () => [] as Array<{ trigger: string; count: number }>),
		getProviderLatencySince: vi.fn(
			async () => [] as Array<{ provider: string; operation: string; averageLatencyMs: number; count: number }>,
		),
		getLatestEventForTargetUser: vi.fn(
			async () =>
				null as {
					jobId: string;
					source: string;
					trigger: string;
					targetUserName: string;
					targetDisplayName: string;
					broadcasterName: string;
					createdAt: Date;
				} | null,
		),
		getProviderLatencyForJob: vi.fn(
			async () => [] as Array<{ provider: string; operation: string; averageLatencyMs: number; count: number }>,
		),
	};

	const jobQueryRepository = {
		getActivePendingCount: vi.fn(async () => 0),
		countByStatus: vi.fn(async (_status: 'pending' | 'processing' | 'succeeded' | 'failed') => 0),
		getMostRecentProcessingJob: vi.fn(async () => null as StoredJob | null),
		getOperationalSnapshot: vi.fn(async () => ({
			pendingCount: 0,
			readyPendingCount: 0,
			processingCount: 0,
			oldestPendingCreatedAt: null as Date | null,
			oldestProcessingLockedAt: null as Date | null,
			sampleProcessingJob: null as StoredJob | null,
		})),
		getCompletionStatsSince: vi.fn(async () => ({
			succeededCount: 0,
			failedCount: 0,
			averageAttempts: null as number | null,
		})),
		getById: vi.fn(async () => null as StoredJob | null),
		list: vi.fn(async () => [] as StoredJob[]),
	};

	const imageGenerator = {
		generate: vi.fn(async () => ({
			success: true as const,
			imageUrl: 'https://cdn.example/image.png',
			publicImageUrl: 'https://cdn.example/image.png',
			analysis: 'analysis',
			finalPrompt: 'prompt',
			styleKeyword: 'oil',
			styleName: 'oil painting',
			structuredOutput: {},
			attempt: 1,
		})),
	};

	const useCase = new HandleTwitchCommandUseCase({
		twitchAdmins: new Set(['admin', 'requester']),
		maxRetries: 0,
		messageThrottle: { run: async <T>(operation: () => Promise<T>): Promise<T> => operation() },
		preferenceRepository,
		handleTwitchEventUseCase: handleTwitchEventUseCase as never,
		imageGenerator,
		generationWriteRepository,
		generationQueryRepository,
		jobQueryRepository,
		broadcastNotifier: {
			sendTwitch: vi.fn(async () => undefined),
			sendDiscordBroadcast: vi.fn(async (message: string) => {
				discordMessages.push(message);
			}),
		},
		broadcasterName: 'streamer',
	});

	return {
		useCase,
		sayMessages,
		discordMessages,
		preferenceRepository,
		handleTwitchEventUseCase,
		imageGenerator,
		generationQueryRepository,
		jobQueryRepository,
	};
}

describe('typed baseline parity: twitch commands', () => {
	const golden = loadGolden();

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('matches aisweatling behavior and ignore text', async () => {
		const fixture = createFixture();
		fixture.preferenceRepository.isUserIgnored.mockResolvedValueOnce(true);

		await fixture.useCase.execute('aisweatling', ['@target'], {
			userName: golden.sample.requestUser,
			broadcasterName: 'streamer',
			say: async (message: string) => {
				fixture.sayMessages.push(message);
			},
		});
		expect(fixture.sayMessages).toEqual([golden.twitchCommands.aisweatlingIgnored]);

		fixture.sayMessages.length = 0;
		fixture.preferenceRepository.isUserIgnored.mockResolvedValueOnce(false);
		await fixture.useCase.execute('aisweatling', ['@target'], {
			userName: golden.sample.requestUser,
			broadcasterName: 'streamer',
			say: async (message: string) => {
				fixture.sayMessages.push(message);
			},
		});
		expect(fixture.handleTwitchEventUseCase.handleCustomGenerationRequest).toHaveBeenCalledWith('requester', 'target', null);
		expect(fixture.sayMessages).toEqual([]);
	});

	it('matches admin preference command text', async () => {
		const fixture = createFixture();
		const ctx: TwitchCommandExecutionContext = {
			userName: golden.sample.adminUser,
			broadcasterName: 'streamer',
			say: async (message: string) => {
				fixture.sayMessages.push(message);
			},
		};

		await fixture.useCase.execute('settheme', [], ctx);
		await fixture.useCase.execute('settheme', ['retro', 'future'], ctx);
		fixture.preferenceRepository.getTheme.mockResolvedValueOnce(undefined);
		await fixture.useCase.execute('gettheme', [], ctx);
		fixture.preferenceRepository.getTheme.mockResolvedValueOnce('retro future');
		await fixture.useCase.execute('gettheme', [], ctx);
		await fixture.useCase.execute('deltheme', [], ctx);

		await fixture.useCase.execute('setmeaning', [], ctx);
		await fixture.useCase.execute('setmeaning', ['target', 'dragon'], ctx);
		await fixture.useCase.execute('delmeaning', [], ctx);
		fixture.preferenceRepository.removeMeaning.mockResolvedValueOnce(true);
		await fixture.useCase.execute('delmeaning', ['target'], ctx);
		fixture.preferenceRepository.removeMeaning.mockResolvedValueOnce(false);
		await fixture.useCase.execute('delmeaning', ['target'], ctx);
		await fixture.useCase.execute('getmeaning', [], ctx);
		fixture.preferenceRepository.getMeaning.mockResolvedValueOnce('dragon');
		await fixture.useCase.execute('getmeaning', ['target'], ctx);

		await fixture.useCase.execute('noai', [], ctx);
		await fixture.useCase.execute('yesai', [], ctx);
		await fixture.useCase.execute('bangifter', ['gifter'], ctx);
		fixture.preferenceRepository.removeBannedGifter.mockResolvedValueOnce(true);
		await fixture.useCase.execute('unbangifter', ['gifter'], ctx);

		expect(fixture.sayMessages).toContain(golden.twitchCommands.setthemeNeedTheme);
		expect(fixture.sayMessages).toContain(golden.twitchCommands.setthemeSuccess);
		expect(fixture.sayMessages).toContain(golden.twitchCommands.getthemeNone);
		expect(fixture.sayMessages).toContain(golden.twitchCommands.getthemeCurrent);
		expect(fixture.sayMessages).toContain(golden.twitchCommands.delthemeSuccess);
		expect(fixture.sayMessages).toContain(golden.twitchCommands.setmeaningNeedArgs);
		expect(fixture.sayMessages).toContain(golden.twitchCommands.setmeaningSuccess);
		expect(fixture.sayMessages).toContain(golden.twitchCommands.delmeaningNeedUsername);
		expect(fixture.sayMessages).toContain(golden.twitchCommands.delmeaningRemoved);
		expect(fixture.sayMessages).toContain(golden.twitchCommands.delmeaningNotFound);
		expect(fixture.sayMessages).toContain(golden.twitchCommands.getmeaningNeedUsername);
		expect(fixture.sayMessages).toContain(golden.twitchCommands.getmeaningSuccess);
		expect(fixture.sayMessages).toContain(golden.twitchCommands.noai);
		expect(fixture.sayMessages).toContain(golden.twitchCommands.yesai);
		expect(fixture.sayMessages).toContain(golden.twitchCommands.bangifterSuccess);
		expect(fixture.sayMessages).toContain(golden.twitchCommands.unbangifterSuccess);
	});

	it('matches misc command text and admin gating output', async () => {
		const fixture = createFixture();
		const ctx: TwitchCommandExecutionContext = {
			userName: golden.sample.adminUser,
			broadcasterName: 'streamer',
			say: async (message: string) => {
				fixture.sayMessages.push(message);
			},
		};

		await fixture.useCase.execute('ping', [], {
			userName: 'partyhorst',
			broadcasterName: 'streamer',
			say: async (message: string) => {
				fixture.sayMessages.push(message);
			},
		});
		await fixture.useCase.execute('say', ['hello', 'world'], ctx);
		await fixture.useCase.execute('uguu', [], ctx);
		await fixture.useCase.execute('quack', [], ctx);
		await fixture.useCase.execute('myai', [], ctx);

		expect(fixture.sayMessages).toEqual([
			golden.twitchCommands.ping,
			golden.twitchCommands.sayMessage,
			golden.twitchCommands.uguu,
			golden.twitchCommands.quack,
			golden.twitchCommands.myai,
		]);
	});

	it('reports admin-visible queue and active job status via aistatus', async () => {
		const fixture = createFixture();
		const ctx: TwitchCommandExecutionContext = {
			userName: golden.sample.adminUser,
			broadcasterName: 'streamer',
			say: async (message: string) => {
				fixture.sayMessages.push(message);
			},
		};

		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(300_000);
		fixture.jobQueryRepository.getOperationalSnapshot.mockResolvedValue({
			pendingCount: 2,
			readyPendingCount: 1,
			processingCount: 1,
			oldestPendingCreatedAt: new Date(180_000),
			oldestProcessingLockedAt: new Date(255_000),
			sampleProcessingJob: {
				id: 'job-1234567890abcdef',
				status: 'processing',
				attemptCount: 3,
				maxRetries: 3,
				priority: 1,
				nextRunAt: new Date(),
				payload: {
					kind: 'custom_twitch',
					broadcasterName: 'streamer',
					targetUserName: 'minecraft',
					targetDisplayName: 'Minecraft',
					trigger: 'custom',
				},
				lastError: null,
				lockedAt: new Date(),
				createdAt: new Date(),
				updatedAt: new Date(),
			},
		});
		fixture.generationQueryRepository.listAudit.mockResolvedValue([
			{
				step: 'job.generation.failed',
				message: 'Cloudflare API returned an invalid response payload.',
			},
		]);

		await fixture.useCase.execute('aistatus', [], ctx);
		expect(fixture.sayMessages[0]).toBe(golden.twitchCommands.aistatusSummary);

		fixture.sayMessages.length = 0;
		fixture.jobQueryRepository.getOperationalSnapshot.mockResolvedValueOnce({
			pendingCount: 2,
			readyPendingCount: 1,
			processingCount: 1,
			oldestPendingCreatedAt: new Date(180_000),
			oldestProcessingLockedAt: new Date(255_000),
			sampleProcessingJob: null,
		});
		await fixture.useCase.execute('aistatus', [], ctx);
		expect(fixture.sayMessages[0]).toBe('@admin AI status: q=2 rdy=1 proc=1 oldestQ=2m longestRun=45s sample=none');
		nowSpy.mockRestore();
	});

	it('reports public nerd stats via aistats with per-window cooldown suppression, validation and failure fallback', async () => {
		const fixture = createFixture();
		const ctx: TwitchCommandExecutionContext = {
			userName: 'viewer',
			broadcasterName: 'streamer',
			say: async (message: string) => {
				fixture.sayMessages.push(message);
			},
		};

		fixture.jobQueryRepository.getOperationalSnapshot.mockResolvedValue({
			pendingCount: 2,
			readyPendingCount: 1,
			processingCount: 1,
			oldestPendingCreatedAt: null,
			oldestProcessingLockedAt: null,
			sampleProcessingJob: null,
		});
		fixture.jobQueryRepository.getCompletionStatsSince.mockResolvedValue({
			succeededCount: 8,
			failedCount: 2,
			averageAttempts: 1.9,
		});
		fixture.generationQueryRepository.getTopTriggersSince.mockResolvedValue([
			{ trigger: 'custom', count: 6 },
			{ trigger: 'onSub', count: 3 },
			{ trigger: 'discord', count: 1 },
		]);
		fixture.generationQueryRepository.getProviderLatencySince.mockResolvedValue([
			{ provider: 'openai', operation: 'responses.structured', averageLatencyMs: 1200, count: 10 },
			{ provider: 'openai', operation: 'responses.prompt-refine', averageLatencyMs: 800, count: 10 },
			{ provider: 'openai', operation: 'images.generate', averageLatencyMs: 4000, count: 10 },
			{ provider: 'cloudflare', operation: 'images.upload', averageLatencyMs: 700, count: 10 },
		]);

		const nowSpy = vi.spyOn(Date, 'now');
		nowSpy.mockReturnValue(1_000_000);
		await fixture.useCase.execute('aistats', [], ctx);
		expect(fixture.sayMessages[0]).toBe(golden.twitchCommands.aistats24h);
		expect(fixture.jobQueryRepository.getCompletionStatsSince).toHaveBeenCalledTimes(1);

		fixture.sayMessages.length = 0;
		nowSpy.mockReturnValue(1_010_000);
		await fixture.useCase.execute('aistats', [], ctx);
		expect(fixture.sayMessages).toEqual([]);
		expect(fixture.jobQueryRepository.getCompletionStatsSince).toHaveBeenCalledTimes(1);

		fixture.sayMessages.length = 0;
		nowSpy.mockReturnValue(1_015_000);
		await fixture.useCase.execute('aistats', ['1h'], ctx);
		expect(fixture.sayMessages[0]).toBe(golden.twitchCommands.aistats1h);
		expect(fixture.jobQueryRepository.getCompletionStatsSince).toHaveBeenCalledTimes(2);

		fixture.sayMessages.length = 0;
		nowSpy.mockReturnValue(1_020_000);
		await fixture.useCase.execute('aistats', ['12h'], ctx);
		expect(fixture.sayMessages).toEqual([]);

		fixture.sayMessages.length = 0;
		nowSpy.mockReturnValue(1_046_000);
		await fixture.useCase.execute('aistats', ['12h'], ctx);
		expect(fixture.sayMessages[0]).toBe(golden.twitchCommands.aistatsUsage);

		fixture.sayMessages.length = 0;
		nowSpy.mockReturnValue(1_080_000);
		fixture.jobQueryRepository.getOperationalSnapshot.mockResolvedValueOnce({
			pendingCount: 2,
			readyPendingCount: 1,
			processingCount: 1,
			oldestPendingCreatedAt: null,
			oldestProcessingLockedAt: null,
			sampleProcessingJob: null,
		});
		await fixture.useCase.execute('aistats', ['7d'], ctx);
		expect(fixture.sayMessages[0]).toBe(golden.twitchCommands.aistats7d);

		fixture.sayMessages.length = 0;
		nowSpy.mockReturnValue(1_120_000);
		fixture.jobQueryRepository.getOperationalSnapshot.mockRejectedValueOnce(new Error('db down'));
		await fixture.useCase.execute('aistats', ['1h'], ctx);
		expect(fixture.sayMessages[0]).toBe(golden.twitchCommands.aistatsUnavailable);

		fixture.sayMessages.length = 0;
		nowSpy.mockReturnValue(1_130_000);
		await fixture.useCase.execute('aistats', ['1h'], ctx);
		expect(fixture.sayMessages).toEqual([]);
		nowSpy.mockRestore();
	});

	it('reports admin-only last generation internals via ailast', async () => {
		const fixture = createFixture();
		const ctx: TwitchCommandExecutionContext = {
			userName: golden.sample.adminUser,
			broadcasterName: 'streamer',
			say: async (message: string) => {
				fixture.sayMessages.push(message);
			},
		};
		const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(300_000);

		fixture.generationQueryRepository.getLatestEventForTargetUser.mockResolvedValueOnce({
			jobId: 'job-1234567890abcdef',
			source: 'twitch',
			trigger: 'custom',
			targetUserName: 'target',
			targetDisplayName: 'Target',
			broadcasterName: 'streamer',
			createdAt: new Date(180_000),
		});
		fixture.jobQueryRepository.getById.mockResolvedValueOnce({
			id: 'job-1234567890abcdef',
			status: 'failed',
			attemptCount: 3,
			maxRetries: 3,
			priority: 1,
			nextRunAt: new Date(),
			payload: {
				kind: 'custom_twitch',
				broadcasterName: 'streamer',
				targetUserName: 'target',
				targetDisplayName: 'Target',
				trigger: 'custom',
			},
			lastError: 'Cloudflare timed out',
			lockedAt: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		});
		fixture.generationQueryRepository.listAudit.mockResolvedValueOnce([
			{
				step: 'job.generation.failed',
				message: 'Cloudflare timed out',
			},
		]);
		fixture.generationQueryRepository.getProviderLatencyForJob.mockResolvedValueOnce([
			{ provider: 'openai', operation: 'responses.structured', averageLatencyMs: 1100, count: 1 },
			{ provider: 'openai', operation: 'images.generate', averageLatencyMs: 3900, count: 1 },
			{ provider: 'cloudflare', operation: 'images.upload', averageLatencyMs: 700, count: 1 },
		]);
		await fixture.useCase.execute('ailast', ['@target'], ctx);
		expect(fixture.sayMessages[0]).toBe(golden.twitchCommands.ailastSummary);

		fixture.sayMessages.length = 0;
		await fixture.useCase.execute('ailast', [], ctx);
		expect(fixture.sayMessages[0]).toBe(golden.twitchCommands.ailastUsage);

		fixture.sayMessages.length = 0;
		fixture.generationQueryRepository.getLatestEventForTargetUser.mockResolvedValueOnce(null);
		await fixture.useCase.execute('ailast', ['@target'], ctx);
		expect(fixture.sayMessages[0]).toBe(golden.twitchCommands.ailastNotFound);

		fixture.sayMessages.length = 0;
		fixture.generationQueryRepository.getLatestEventForTargetUser.mockRejectedValueOnce(new Error('db down'));
		await fixture.useCase.execute('ailast', ['@target'], ctx);
		expect(fixture.sayMessages[0]).toBe(golden.twitchCommands.ailastUnavailable);
		nowSpy.mockRestore();
	});

	it('blocks aistatus and ailast for non-admin users', async () => {
		const fixture = createFixture();
		await fixture.useCase.execute('aistatus', [], {
			userName: 'viewer',
			broadcasterName: 'streamer',
			say: async (message: string) => {
				fixture.sayMessages.push(message);
			},
		});
		await fixture.useCase.execute('ailast', ['target'], {
			userName: 'viewer',
			broadcasterName: 'streamer',
			say: async (message: string) => {
				fixture.sayMessages.push(message);
			},
		});
		expect(fixture.sayMessages).toEqual([]);
	});

	it('matches testall and canceltests parity messages and dispatch order', async () => {
		const fixture = createFixture();
		const ctx: TwitchCommandExecutionContext = {
			userName: golden.sample.adminUser,
			broadcasterName: 'streamer',
			say: async (message: string) => {
				fixture.sayMessages.push(message);
			},
		};

		(fixture.useCase as unknown as { testGenerationState: { isRunning: boolean; shouldCancel: boolean } }).testGenerationState.isRunning =
			true;
		await fixture.useCase.execute('testall', ['target'], ctx);
		expect(fixture.sayMessages.pop()).toBe(golden.twitchCommands.testallAlreadyRunning);

		(fixture.useCase as unknown as { testGenerationState: { isRunning: boolean; shouldCancel: boolean } }).testGenerationState.isRunning =
			false;
		await fixture.useCase.execute('testall', [], ctx);
		await fixture.useCase.execute('testall', ['target', '0'], ctx);
		expect(fixture.sayMessages).toContain(golden.twitchCommands.testallNeedTarget);
		expect(fixture.sayMessages).toContain(golden.twitchCommands.testallNeedValidCount);

		const originalTemplates = [...DALLE_TEMPLATES];
		DALLE_TEMPLATES.splice(0, DALLE_TEMPLATES.length, originalTemplates[0]!);
		let nowCalls = 0;
		const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
			nowCalls += 1;
			return nowCalls === 1 ? 0 : 4000;
		});

		fixture.sayMessages.length = 0;
		fixture.discordMessages.length = 0;
		await fixture.useCase.execute('testall', ['target', '1'], ctx);
		dateSpy.mockRestore();
		DALLE_TEMPLATES.splice(0, DALLE_TEMPLATES.length, ...originalTemplates);

		expect(fixture.sayMessages).toEqual([
			golden.twitchCommands.testallStart,
			golden.twitchCommands.testSuccessTwitch,
			golden.twitchCommands.testSummaryTwitch,
		]);
		expect(fixture.discordMessages).toEqual([golden.twitchCommands.testSuccessDiscord, golden.twitchCommands.testSummaryDiscord]);

		fixture.sayMessages.length = 0;
		await fixture.useCase.execute('canceltests', [], ctx);
		expect(fixture.sayMessages).toEqual([golden.twitchCommands.noRunningTests]);

		(fixture.useCase as unknown as { testGenerationState: { isRunning: boolean; shouldCancel: boolean } }).testGenerationState.isRunning =
			true;
		await fixture.useCase.execute('canceltests', [], ctx);
		expect(fixture.sayMessages[fixture.sayMessages.length - 1]).toBe(golden.twitchCommands.cancelTests);

		fixture.sayMessages.length = 0;
		await fixture.useCase.execute('canceltests', [], {
			userName: 'viewer',
			broadcasterName: 'streamer',
			say: async (message: string) => {
				fixture.sayMessages.push(message);
			},
		});
		expect(fixture.sayMessages).toEqual([]);
	});

	it('covers testall cancellation and error branches', async () => {
		const fixture = createFixture();
		const ctx: TwitchCommandExecutionContext = {
			userName: golden.sample.adminUser,
			broadcasterName: 'streamer',
			say: async (message: string) => {
				fixture.sayMessages.push(message);
			},
		};

		const originalTemplates = [...DALLE_TEMPLATES];
		DALLE_TEMPLATES.splice(0, DALLE_TEMPLATES.length, originalTemplates[0]!, originalTemplates[1]!);
		try {
			fixture.imageGenerator.generate.mockImplementationOnce(async () => {
				(
					fixture.useCase as unknown as { testGenerationState: { isRunning: boolean; shouldCancel: boolean } }
				).testGenerationState.shouldCancel = true;
				return {
					success: true as const,
					imageUrl: golden.sample.imageUrl,
					publicImageUrl: golden.sample.imageUrl,
					analysis: 'analysis',
					finalPrompt: 'prompt',
					styleKeyword: 'oil',
					styleName: 'oil painting',
					structuredOutput: {},
					attempt: 1,
				};
			});
			let nowCalls = 0;
			const dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => {
				nowCalls += 1;
				return nowCalls === 1 ? 0 : 4000;
			});
			await fixture.useCase.execute('testall', ['target', '1'], ctx);
			dateSpy.mockRestore();
			expect(fixture.sayMessages[fixture.sayMessages.length - 1]).toMatch(/^@admin Test generation cancelled\./);

			fixture.sayMessages.length = 0;
			fixture.imageGenerator.generate.mockRejectedValueOnce(new Error('boom'));
			await fixture.useCase.execute('testall', ['target', '1'], ctx);
			expect(fixture.sayMessages).toContain(golden.twitchCommands.testStyleError);
		} finally {
			DALLE_TEMPLATES.splice(0, DALLE_TEMPLATES.length, ...originalTemplates);
		}
	});
});
