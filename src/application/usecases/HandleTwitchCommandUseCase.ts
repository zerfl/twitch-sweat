import { nanoid } from 'nanoid';
import { DALLE_TEMPLATES } from '../../constants/styles';
import {
	commandAisweatlingIgnored,
	commandAiLastNotFound,
	commandAiLastSummary,
	commandAiLastUnavailable,
	commandAiLastUsage,
	commandAiStatsInvalidWindow,
	commandAiStatsSummary,
	commandAiStatsUnavailable,
	commandAiStatusSummary,
	commandCancelTests,
	commandCurrentTheme,
	commandGifterBanned,
	commandGifterUnbanned,
	commandMeaningGet,
	commandMeaningNotFound,
	commandMeaningRemoved,
	commandMeaningSet,
	commandMyAi,
	commandNeedTestTarget,
	commandNeedTheme,
	commandNeedUsername,
	commandNeedUsernameAndMeaning,
	commandNeedValidTestCount,
	commandNoRunningTests,
	commandNoTheme,
	commandPingPong,
	commandTestAlreadyRunning,
	commandTestStart,
	commandTestStyleError,
	commandTestStyleFailure,
	commandTestSummary,
	commandThemeRemoved,
	commandThemeSet,
	commandNoAi,
	testGenerationSuccess,
	testGenerationSuccessDiscord,
	commandYesAi,
} from '../../domain/policies/MessageTemplatePolicy';
import { isAdminOrBroadcaster } from '../../domain/policies/AuthorizationPolicy';
import { retryAsyncOperation, truncate } from '../../utils/helpers';
import type {
	BroadcastNotifierContract,
	GenerationQueryRepositoryContract,
	GenerationWriteRepositoryContract,
	ImageGeneratorContract,
	JobQueryRepositoryContract,
	MessageThrottleContract,
	PreferenceRepositoryContract,
	QueryResultRow,
	StoredJob,
} from '../contracts';
import type { HandleTwitchEventUseCase } from './HandleTwitchEventUseCase';

type AiStatsWindow = '1h' | '24h' | '7d';

const AI_STATS_WINDOW_MS: Record<AiStatsWindow, number> = {
	'1h': 60 * 60 * 1000,
	'24h': 24 * 60 * 60 * 1000,
	'7d': 7 * 24 * 60 * 60 * 1000,
};

const AI_STATS_COOLDOWN_MS = 30 * 1000;

export interface TwitchCommandExecutionContext {
	userName: string;
	broadcasterName: string;
	say: (message: string) => Promise<void>;
}

interface HandleTwitchCommandDeps {
	twitchAdmins: Set<string>;
	maxRetries: number;
	messageThrottle: MessageThrottleContract;
	preferenceRepository: PreferenceRepositoryContract;
	handleTwitchEventUseCase: HandleTwitchEventUseCase;
	imageGenerator: ImageGeneratorContract;
	generationWriteRepository: GenerationWriteRepositoryContract;
	generationQueryRepository: GenerationQueryRepositoryContract;
	jobQueryRepository: JobQueryRepositoryContract;
	broadcastNotifier: BroadcastNotifierContract;
	broadcasterName: string;
}

export class HandleTwitchCommandUseCase {
	private testGenerationState = {
		isRunning: false,
		shouldCancel: false,
	};
	private readonly aiStatsLastOutputAtByWindow = new Map<AiStatsWindow, number>();
	private aiStatsLastAnyOutputAtMs: number | null = null;

	constructor(private readonly deps: HandleTwitchCommandDeps) {}

	async execute(command: string, params: string[], ctx: TwitchCommandExecutionContext): Promise<void> {
		switch (command) {
			case 'aisweatling':
				await this.onAisweatling(params, ctx);
				return;
			case 'settheme':
				await this.onSetTheme(params, ctx);
				return;
			case 'deltheme':
				await this.onDelTheme(ctx);
				return;
			case 'gettheme':
				await this.onGetTheme(ctx);
				return;
			case 'setmeaning':
				await this.onSetMeaning(params, ctx);
				return;
			case 'delmeaning':
				await this.onDelMeaning(params, ctx);
				return;
			case 'getmeaning':
				await this.onGetMeaning(params, ctx);
				return;
			case 'noai':
				await this.onNoAi(ctx);
				return;
			case 'yesai':
				await this.onYesAi(ctx);
				return;
			case 'bangifter':
				await this.onBanGifter(params, ctx);
				return;
			case 'unbangifter':
				await this.onUnbanGifter(params, ctx);
				return;
			case 'ping':
				await this.onPing(ctx);
				return;
			case 'say':
				await this.onSay(params, ctx);
				return;
			case 'uguu':
				await this.onUguu(ctx);
				return;
			case 'quack':
				await this.onQuack(ctx);
				return;
			case 'myai':
				await this.onMyAi(ctx);
				return;
			case 'aistatus':
				await this.onAiStatus(ctx);
				return;
			case 'aistats':
				await this.onAiStats(params, ctx);
				return;
			case 'ailast':
				await this.onAiLast(params, ctx);
				return;
			case 'testall':
				await this.onTestAll(params, ctx);
				return;
			case 'canceltests':
				await this.onCancelTests(ctx);
				return;
			default:
				return;
		}
	}

	private canAdmin(ctx: TwitchCommandExecutionContext): boolean {
		return isAdminOrBroadcaster(ctx.userName, ctx.broadcasterName, this.deps.twitchAdmins);
	}

	private async throttledSay(ctx: TwitchCommandExecutionContext, message: string): Promise<void> {
		await this.deps.messageThrottle.run(() => ctx.say(message));
	}

	private async onAisweatling(params: string[], ctx: TwitchCommandExecutionContext): Promise<void> {
		if (!this.canAdmin(ctx)) {
			return;
		}
		if (params.length === 0) {
			return;
		}
		const targetParam = params[0];
		if (!targetParam) {
			return;
		}
		const target = targetParam.replace('@', '');
		if (await this.deps.preferenceRepository.isUserIgnored(target.toLowerCase())) {
			await this.throttledSay(ctx, commandAisweatlingIgnored(ctx.userName, target));
			return;
		}
		const specifiedStyle = params[1] ?? null;
		await this.deps.handleTwitchEventUseCase.handleCustomGenerationRequest(ctx.userName, target, specifiedStyle);
	}

	private async onSetTheme(params: string[], ctx: TwitchCommandExecutionContext): Promise<void> {
		if (!this.canAdmin(ctx)) {
			return;
		}
		if (params.length === 0) {
			await this.throttledSay(ctx, commandNeedTheme(ctx.userName));
			return;
		}
		const theme = params.join(' ');
		await this.deps.preferenceRepository.setTheme(theme);
		await this.throttledSay(ctx, commandThemeSet(ctx.userName, theme));
	}

	private async onDelTheme(ctx: TwitchCommandExecutionContext): Promise<void> {
		if (!this.canAdmin(ctx)) {
			return;
		}
		await this.deps.preferenceRepository.removeTheme();
		await this.throttledSay(ctx, commandThemeRemoved(ctx.userName));
	}

	private async onGetTheme(ctx: TwitchCommandExecutionContext): Promise<void> {
		const theme = await this.deps.preferenceRepository.getTheme();
		await this.throttledSay(ctx, theme ? commandCurrentTheme(ctx.userName, theme) : commandNoTheme(ctx.userName));
	}

	private async onSetMeaning(params: string[], ctx: TwitchCommandExecutionContext): Promise<void> {
		if (!this.canAdmin(ctx)) {
			return;
		}
		if (params.length < 2) {
			await this.throttledSay(ctx, commandNeedUsernameAndMeaning(ctx.userName));
			return;
		}
		const user = params[0];
		if (!user) {
			await this.throttledSay(ctx, commandNeedUsernameAndMeaning(ctx.userName));
			return;
		}
		const meaning = params.slice(1).join(' ');
		await this.deps.preferenceRepository.setMeaning(user, meaning);
		await this.throttledSay(ctx, commandMeaningSet(ctx.userName, user));
	}

	private async onDelMeaning(params: string[], ctx: TwitchCommandExecutionContext): Promise<void> {
		if (!this.canAdmin(ctx)) {
			return;
		}
		if (params.length !== 1) {
			await this.throttledSay(ctx, commandNeedUsername(ctx.userName));
			return;
		}
		const user = params[0];
		if (!user) {
			await this.throttledSay(ctx, commandNeedUsername(ctx.userName));
			return;
		}
		const removed = await this.deps.preferenceRepository.removeMeaning(user);
		await this.throttledSay(
			ctx,
			removed ? commandMeaningRemoved(ctx.userName, user) : commandMeaningNotFound(ctx.userName, user),
		);
	}

	private async onGetMeaning(params: string[], ctx: TwitchCommandExecutionContext): Promise<void> {
		if (params.length !== 1) {
			await this.throttledSay(ctx, commandNeedUsername(ctx.userName));
			return;
		}
		const user = params[0];
		if (!user) {
			await this.throttledSay(ctx, commandNeedUsername(ctx.userName));
			return;
		}
		const meaning = await this.deps.preferenceRepository.getMeaning(user.toLowerCase());
		await this.throttledSay(ctx, commandMeaningGet(ctx.userName, user, meaning));
	}

	private async onNoAi(ctx: TwitchCommandExecutionContext): Promise<void> {
		await this.deps.preferenceRepository.addIgnoredUser(ctx.userName.toLowerCase());
		await this.throttledSay(ctx, commandNoAi(ctx.userName));
	}

	private async onYesAi(ctx: TwitchCommandExecutionContext): Promise<void> {
		await this.deps.preferenceRepository.removeIgnoredUser(ctx.userName.toLowerCase());
		await this.throttledSay(ctx, commandYesAi(ctx.userName));
	}

	private async onBanGifter(params: string[], ctx: TwitchCommandExecutionContext): Promise<void> {
		if (!this.canAdmin(ctx)) {
			return;
		}
		if (params.length !== 1) {
			await this.throttledSay(ctx, commandNeedUsername(ctx.userName));
			return;
		}
		const gifter = params[0];
		if (!gifter) {
			await this.throttledSay(ctx, commandNeedUsername(ctx.userName));
			return;
		}
		await this.deps.preferenceRepository.addBannedGifter(gifter);
		await this.throttledSay(ctx, commandGifterBanned(ctx.userName, gifter));
	}

	private async onUnbanGifter(params: string[], ctx: TwitchCommandExecutionContext): Promise<void> {
		if (!this.canAdmin(ctx)) {
			return;
		}
		if (params.length !== 1) {
			await this.throttledSay(ctx, commandNeedUsername(ctx.userName));
			return;
		}
		const gifter = params[0];
		if (!gifter) {
			await this.throttledSay(ctx, commandNeedUsername(ctx.userName));
			return;
		}
		const removed = await this.deps.preferenceRepository.removeBannedGifter(gifter);
		if (removed) {
			await this.throttledSay(ctx, commandGifterUnbanned(ctx.userName, gifter));
		}
	}

	private async onPing(ctx: TwitchCommandExecutionContext): Promise<void> {
		if (ctx.userName.toLowerCase() !== 'partyhorst') {
			return;
		}
		await this.throttledSay(ctx, commandPingPong(ctx.userName));
	}

	private async onSay(params: string[], ctx: TwitchCommandExecutionContext): Promise<void> {
		if (!this.canAdmin(ctx)) {
			return;
		}
		if (params.length === 0) {
			return;
		}
		await this.throttledSay(ctx, params.join(' '));
	}

	private async onUguu(ctx: TwitchCommandExecutionContext): Promise<void> {
		if (!this.canAdmin(ctx)) {
			return;
		}
		await this.throttledSay(ctx, '!uguu');
	}

	private async onQuack(ctx: TwitchCommandExecutionContext): Promise<void> {
		if (!this.canAdmin(ctx)) {
			return;
		}
		await this.throttledSay(ctx, '!quack');
	}

	private async onMyAi(ctx: TwitchCommandExecutionContext): Promise<void> {
		await this.throttledSay(ctx, commandMyAi(ctx.userName));
	}

	private async onAiStatus(ctx: TwitchCommandExecutionContext): Promise<void> {
		if (!this.canAdmin(ctx)) {
			return;
		}

		const snapshot = await this.deps.jobQueryRepository.getOperationalSnapshot();
		let sample = 'none';
		const sampleJob = snapshot.sampleProcessingJob;
		if (sampleJob) {
			const rows = await this.deps.generationQueryRepository.listAudit({
				limit: 1,
				jobId: sampleJob.id,
			});
			const latestAudit = rows[0];
			const latestStep = truncate(this.getRowString(latestAudit, 'step') ?? 'n/a', 24);
			const attemptProgress = `${Math.max(sampleJob.attemptCount, 1)}/${sampleJob.maxRetries + 1}`;
			sample = `${this.shortJobId(sampleJob.id)} target=${truncate(sampleJob.payload.targetDisplayName, 12)} attempt=${attemptProgress} step=${latestStep}`;
		}

		await this.throttledSay(
			ctx,
			commandAiStatusSummary(
				ctx.userName,
				snapshot.pendingCount,
				snapshot.readyPendingCount,
				snapshot.processingCount,
				this.formatAge(snapshot.oldestPendingCreatedAt),
				this.formatAge(snapshot.oldestProcessingLockedAt),
				sample,
			),
		);
	}

	private async onAiStats(params: string[], ctx: TwitchCommandExecutionContext): Promise<void> {
		const now = Date.now();
		const window = this.parseAiStatsWindow(params[0]);
		if (!window) {
			if (this.isAiStatsAnyCooldownActive(now)) {
				return;
			}
			await this.throttledSay(ctx, commandAiStatsInvalidWindow(ctx.userName));
			this.markAiStatsOutput(null, Date.now());
			return;
		}

		if (this.isAiStatsWindowCooldownActive(window, now)) {
			return;
		}

		const since = new Date(now - AI_STATS_WINDOW_MS[window]);
		try {
			const [snapshot, completionStats, topTriggers, providerLatency] = await Promise.all([
				this.deps.jobQueryRepository.getOperationalSnapshot(),
				this.deps.jobQueryRepository.getCompletionStatsSince(since),
				this.deps.generationQueryRepository.getTopTriggersSince(since, 3),
				this.deps.generationQueryRepository.getProviderLatencySince(since),
			]);

			const completedCount = completionStats.succeededCount + completionStats.failedCount;
			const successRate =
				completedCount > 0 ? this.formatRate((completionStats.succeededCount / completedCount) * 100) : 'n/a';
			const hours = AI_STATS_WINDOW_MS[window] / (60 * 60 * 1000);
			const throughput = this.formatRate(completedCount / hours);
			const averageAttempts = completionStats.averageAttempts === null ? 'n/a' : this.formatRate(completionStats.averageAttempts);

			const message = commandAiStatsSummary(
				ctx.userName,
				window,
				completionStats.succeededCount,
				completionStats.failedCount,
				snapshot.pendingCount,
				snapshot.readyPendingCount,
				snapshot.processingCount,
				successRate,
				throughput,
				averageAttempts,
				this.formatTriggers(topTriggers),
				this.formatLatencySummary(providerLatency),
			);
			await this.throttledSay(ctx, message);
			this.markAiStatsOutput(window, Date.now());
		} catch (error) {
			console.log('Failed to generate AI stats:', error);
			await this.throttledSay(ctx, commandAiStatsUnavailable(ctx.userName));
			this.markAiStatsOutput(window, Date.now());
		}
	}

	private async onAiLast(params: string[], ctx: TwitchCommandExecutionContext): Promise<void> {
		if (!this.canAdmin(ctx)) {
			return;
		}

		const targetUserName = this.normalizeTargetUserName(params[0]);
		if (!targetUserName) {
			await this.throttledSay(ctx, commandAiLastUsage(ctx.userName));
			return;
		}

		try {
			const latestEvent = await this.deps.generationQueryRepository.getLatestEventForTargetUser(
				targetUserName,
				this.deps.broadcasterName,
			);
			if (!latestEvent) {
				await this.throttledSay(ctx, commandAiLastNotFound(ctx.userName, targetUserName));
				return;
			}

			const [job, auditRows, providerLatency] = await Promise.all([
				this.deps.jobQueryRepository.getById(latestEvent.jobId),
				this.deps.generationQueryRepository.listAudit({ limit: 1, jobId: latestEvent.jobId }),
				this.deps.generationQueryRepository.getProviderLatencyForJob(latestEvent.jobId),
			]);

			const latestAudit = auditRows[0];
			const latestStep = truncate(this.getRowString(latestAudit, 'step') ?? 'n/a', 24);
			const auditMessage = this.getRowString(latestAudit, 'message');
			const fallbackError = latestStep.includes('fail') ? auditMessage : undefined;
			const errorToken = truncate(job?.lastError ?? fallbackError ?? 'none', 48);
			const age = this.formatAge(this.toDateOrNull(latestEvent.createdAt));

			await this.throttledSay(
				ctx,
				commandAiLastSummary(
					ctx.userName,
					targetUserName,
					this.shortJobId(latestEvent.jobId),
					job?.status ?? 'n/a',
					truncate(job?.payload.kind ?? 'n/a', 18),
					truncate(latestEvent.trigger, 18),
					age,
					this.formatAttemptProgress(job),
					latestStep,
					errorToken,
					this.formatLatencySummary(providerLatency),
				),
			);
		} catch (error) {
			console.log(`Failed to fetch AI last stats for ${targetUserName}:`, error);
			await this.throttledSay(ctx, commandAiLastUnavailable(ctx.userName, targetUserName));
		}
	}

	private async onTestAll(params: string[], ctx: TwitchCommandExecutionContext): Promise<void> {
		if (!this.canAdmin(ctx)) {
			return;
		}
		if (this.testGenerationState.isRunning) {
			await this.throttledSay(ctx, commandTestAlreadyRunning(ctx.userName));
			return;
		}
		if (params.length === 0) {
			await this.throttledSay(ctx, commandNeedTestTarget(ctx.userName));
			return;
		}
		const targetParam = params[0];
		if (!targetParam) {
			await this.throttledSay(ctx, commandNeedTestTarget(ctx.userName));
			return;
		}
		const target = targetParam.replace('@', '');
		const count = params.length > 1 ? Number.parseInt(params[1] ?? '', 10) : 1;
		if (Number.isNaN(count) || count < 1) {
			await this.throttledSay(ctx, commandNeedValidTestCount(ctx.userName));
			return;
		}

		this.testGenerationState.isRunning = true;
		this.testGenerationState.shouldCancel = false;
		const startTime = Date.now();
		const totalTasks = count * DALLE_TEMPLATES.length;
		await this.throttledSay(ctx, commandTestStart(ctx.userName, target, count, totalTasks));

		let successCount = 0;
		let failureCount = 0;
		let currentStyleKeyword = 'unknown';

		try {
			for (const template of DALLE_TEMPLATES) {
				for (let i = 0; i < count; i += 1) {
					currentStyleKeyword = template.keyword;
					if (this.testGenerationState.shouldCancel) {
						break;
					}
					const syntheticJobId = `test-${nanoid(12)}`;
					const generation = await retryAsyncOperation(async (_target: string, attempt: number) => {
						return this.deps.imageGenerator.generate({
							jobId: syntheticJobId,
							userName: target.toLowerCase(),
							userDisplayName: target,
							theme: await this.deps.preferenceRepository.getTheme(),
							style: template.keyword,
							attempt,
							metadata: {
								source: 'twitch',
								channel: this.deps.broadcasterName,
								target,
								trigger: 'test',
								style: template.keyword,
							},
							getMeaning: (userName) => this.deps.preferenceRepository.getMeaning(userName),
							onProviderCall: async (providerCall) => {
								const attemptId = await this.deps.generationWriteRepository.createAttempt(syntheticJobId, attempt);
								await this.deps.generationWriteRepository.recordProviderCall(
									syntheticJobId,
									attemptId,
									providerCall,
								);
								await this.deps.generationWriteRepository.completeAttempt(
									attemptId,
									providerCall.errorMessage ? 'failed' : 'succeeded',
									providerCall.errorMessage,
								);
							},
						});
					}, this.deps.maxRetries, target);

					if (!generation.success) {
						failureCount += 1;
						await this.throttledSay(ctx, commandTestStyleFailure(ctx.userName, template.keyword));
						continue;
					}

					successCount += 1;
					await this.deps.generationWriteRepository.saveOutput(syntheticJobId, {
						broadcasterName: this.deps.broadcasterName,
						targetUserName: target,
						targetDisplayName: target,
						theme: (await this.deps.preferenceRepository.getTheme()) ?? '',
						result: generation,
					});

					await this.throttledSay(ctx, testGenerationSuccess(ctx.userName, template.keyword, generation.publicImageUrl));
					await this.deps.broadcastNotifier.sendDiscordBroadcast(
						testGenerationSuccessDiscord(target, template.keyword, generation.publicImageUrl),
					);
					if (this.testGenerationState.shouldCancel) {
						break;
					}
				}
				if (this.testGenerationState.shouldCancel) {
					break;
				}
			}
		} catch (error) {
			failureCount += 1;
			console.log('Error generating test image:', error);
			await this.throttledSay(ctx, commandTestStyleError(ctx.userName, currentStyleKeyword));
		} finally {
			this.testGenerationState.isRunning = false;
			const wasCancelled = this.testGenerationState.shouldCancel;
			this.testGenerationState.shouldCancel = false;
			const totalSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
			const summary = commandTestSummary(wasCancelled, successCount, failureCount, totalTasks, totalSeconds);
			await this.throttledSay(ctx, `@${ctx.userName} ${summary}`);
			await this.deps.broadcastNotifier.sendDiscordBroadcast(summary);
		}
	}

	private async onCancelTests(ctx: TwitchCommandExecutionContext): Promise<void> {
		if (!this.canAdmin(ctx)) {
			return;
		}
		if (!this.testGenerationState.isRunning) {
			await this.throttledSay(ctx, commandNoRunningTests(ctx.userName));
			return;
		}
		this.testGenerationState.shouldCancel = true;
		await this.throttledSay(ctx, commandCancelTests(ctx.userName));
	}

	private getRowString(row: QueryResultRow | undefined, key: string): string | undefined {
		if (!row) {
			return undefined;
		}
		const value = row[key];
		return typeof value === 'string' ? value : undefined;
	}

	private isAiStatsWindowCooldownActive(window: AiStatsWindow, nowMs: number): boolean {
		const lastOutputAt = this.aiStatsLastOutputAtByWindow.get(window);
		return lastOutputAt !== undefined && nowMs - lastOutputAt < AI_STATS_COOLDOWN_MS;
	}

	private isAiStatsAnyCooldownActive(nowMs: number): boolean {
		return this.aiStatsLastAnyOutputAtMs !== null && nowMs - this.aiStatsLastAnyOutputAtMs < AI_STATS_COOLDOWN_MS;
	}

	private markAiStatsOutput(window: AiStatsWindow | null, nowMs: number): void {
		if (window) {
			this.aiStatsLastOutputAtByWindow.set(window, nowMs);
		}
		this.aiStatsLastAnyOutputAtMs = nowMs;
	}

	private normalizeTargetUserName(raw: string | undefined): string | null {
		if (!raw) {
			return null;
		}
		const canonical = raw.trim().replace(/^@+/, '').toLowerCase();
		return canonical.length > 0 ? canonical : null;
	}

	private parseAiStatsWindow(raw: string | undefined): AiStatsWindow | null {
		if (!raw) {
			return '24h';
		}
		const normalized = raw.toLowerCase();
		if (normalized === '1h' || normalized === '24h' || normalized === '7d') {
			return normalized;
		}
		return null;
	}

	private formatAge(value: Date | null): string {
		if (!value) {
			return 'n/a';
		}
		const elapsedMs = Math.max(0, Date.now() - value.getTime());
		const totalSeconds = Math.floor(elapsedMs / 1000);
		if (totalSeconds < 60) {
			return `${totalSeconds}s`;
		}
		const totalMinutes = Math.floor(totalSeconds / 60);
		if (totalMinutes < 60) {
			return `${totalMinutes}m`;
		}
		const totalHours = Math.floor(totalMinutes / 60);
		if (totalHours < 24) {
			return `${totalHours}h`;
		}
		return `${Math.floor(totalHours / 24)}d`;
	}

	private shortJobId(jobId: string): string {
		return truncate(jobId, 12);
	}

	private formatAttemptProgress(job: StoredJob | null): string {
		if (!job) {
			return 'n/a';
		}
		const maxAttempts = Math.max(job.maxRetries + 1, 1);
		return `${Math.max(job.attemptCount, 0)}/${maxAttempts}`;
	}

	private toDateOrNull(value: Date | string | null | undefined): Date | null {
		if (!value) {
			return null;
		}
		if (value instanceof Date) {
			return value;
		}
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? null : parsed;
	}

	private formatTriggers(triggers: Array<{ trigger: string; count: number }>): string {
		if (triggers.length === 0) {
			return 'none';
		}
		return triggers
			.map((entry) => {
				return `${truncate(entry.trigger, 12)}:${entry.count}`;
			})
			.join(',');
	}

	private formatLatencySummary(
		stats: Array<{ operation: string; averageLatencyMs: number; count: number }>,
	): string {
		const targetOperations: Record<string, string> = {
			'responses.structured': 's',
			'responses.prompt-refine': 'r',
			'images.generate': 'i',
			'images.upload': 'u',
		};
		const aggregates = new Map<string, { weightedLatencyTotal: number; count: number }>();
		for (const stat of stats) {
			if (!(stat.operation in targetOperations)) {
				continue;
			}
			const current = aggregates.get(stat.operation) ?? { weightedLatencyTotal: 0, count: 0 };
			current.weightedLatencyTotal += stat.averageLatencyMs * stat.count;
			current.count += stat.count;
			aggregates.set(stat.operation, current);
		}
		const orderedOperations: Array<[string, string]> = [
			['responses.structured', 's'],
			['responses.prompt-refine', 'r'],
			['images.generate', 'i'],
			['images.upload', 'u'],
		];
		const parts: string[] = [];
		for (const [operation, short] of orderedOperations) {
			const aggregate = aggregates.get(operation);
			if (!aggregate || aggregate.count === 0) {
				continue;
			}
			const averageMs = Math.round(aggregate.weightedLatencyTotal / aggregate.count);
			parts.push(`${short}=${averageMs}ms`);
		}
		return parts.length === 0 ? 'n/a' : parts.join(',');
	}

	private formatRate(value: number): string {
		if (!Number.isFinite(value)) {
			return 'n/a';
		}
		return value.toFixed(1);
	}
}
