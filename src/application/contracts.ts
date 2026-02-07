import type { AccessToken } from '@twurple/auth';
import type {
	AuditRecord,
	GenerationJobPayload,
	GenerationResult,
	JobStatus,
	ProviderCallEnvelope,
	TriggerEventRecord,
} from '../domain/types';

export interface StoredJob {
	id: string;
	status: JobStatus;
	attemptCount: number;
	maxRetries: number;
	priority: number;
	nextRunAt: Date;
	payload: GenerationJobPayload;
	lastError: string | null;
	lockedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export type QueryResultRow = Record<string, unknown>;

export interface OperationalSnapshot {
	pendingCount: number;
	readyPendingCount: number;
	processingCount: number;
	oldestPendingCreatedAt: Date | null;
	oldestProcessingLockedAt: Date | null;
	sampleProcessingJob: StoredJob | null;
}

export interface CompletionStats {
	succeededCount: number;
	failedCount: number;
	averageAttempts: number | null;
}

export interface TriggerCount {
	trigger: string;
	count: number;
}

export interface ProviderLatencyStat {
	provider: string;
	operation: string;
	averageLatencyMs: number;
	count: number;
}

export interface LatestGenerationEvent {
	jobId: string;
	source: string;
	trigger: string;
	targetUserName: string;
	targetDisplayName: string;
	broadcasterName: string;
	createdAt: Date;
}

export interface ListGenerationsQuery {
	limit: number;
	cursor?: number;
	username?: string;
	trigger?: string;
	dateFrom?: Date;
	dateTo?: Date;
}

export interface ListDiagnosticsQuery {
	limit: number;
	jobId?: string;
}

export interface GenerationWriteRepositoryContract {
	createEvent(jobId: string, event: TriggerEventRecord): Promise<void>;
	createAttempt(jobId: string, attemptNumber: number): Promise<number>;
	completeAttempt(attemptId: number, status: 'succeeded' | 'failed', errorMessage?: string): Promise<void>;
	recordProviderCall(jobId: string, attemptId: number, providerCall: ProviderCallEnvelope): Promise<void>;
	saveOutput(jobId: string, payload: {
		broadcasterName: string;
		targetUserName: string;
		targetDisplayName: string;
		theme: string;
		result: GenerationResult;
	}): Promise<void>;
	recordOutboundMessage(args: {
		jobId: string;
		platform: 'twitch' | 'discord';
		target: string;
		payload: unknown;
		success: boolean;
		errorMessage?: string;
	}): Promise<void>;
	appendAudit(jobId: string | null, record: AuditRecord): Promise<void>;
}

export interface GenerationQueryRepositoryContract {
	listGenerations(params: ListGenerationsQuery): Promise<QueryResultRow[]>;
	getGenerationById(id: number): Promise<QueryResultRow | null>;
	listEvents(params: ListDiagnosticsQuery): Promise<QueryResultRow[]>;
	listProviderCalls(params: ListDiagnosticsQuery): Promise<QueryResultRow[]>;
	listAudit(params: ListDiagnosticsQuery): Promise<QueryResultRow[]>;
	getTopTriggersSince(since: Date, limit: number): Promise<TriggerCount[]>;
	getProviderLatencySince(since: Date): Promise<ProviderLatencyStat[]>;
	getLatestEventForTargetUser(targetUserName: string, broadcasterName: string): Promise<LatestGenerationEvent | null>;
	getProviderLatencyForJob(jobId: string): Promise<ProviderLatencyStat[]>;
}

export interface JobWriteRepositoryContract {
	enqueue(payload: GenerationJobPayload, maxRetries: number, priority?: number): Promise<string>;
	claimNextRunnable(): Promise<StoredJob | null>;
	requeueStaleProcessing(olderThan: Date): Promise<number>;
	incrementAttempt(jobId: string): Promise<void>;
	markSucceeded(jobId: string): Promise<void>;
	markFailed(jobId: string, errorMessage: string): Promise<void>;
	requeue(jobId: string, errorMessage: string, nextRunAt: Date): Promise<void>;
}

export interface JobQueryRepositoryContract {
	getActivePendingCount(): Promise<number>;
	countByStatus(status: JobStatus): Promise<number>;
	getMostRecentProcessingJob(): Promise<StoredJob | null>;
	getOperationalSnapshot(): Promise<OperationalSnapshot>;
	getCompletionStatsSince(since: Date): Promise<CompletionStats>;
	getById(jobId: string): Promise<StoredJob | null>;
	list(params: { limit: number; cursor?: string; status?: JobStatus }): Promise<StoredJob[]>;
}

export interface PreferenceRepositoryContract {
	isUserIgnored(userName: string): Promise<boolean>;
	addIgnoredUser(userName: string): Promise<void>;
	removeIgnoredUser(userName: string): Promise<void>;
	setTheme(theme: string): Promise<void>;
	removeTheme(): Promise<boolean>;
	getTheme(): Promise<string | undefined>;
	setMeaning(userName: string, meaning: string): Promise<void>;
	removeMeaning(userName: string): Promise<boolean>;
	getMeaning(userName: string): Promise<string>;
	addBannedGifter(gifterName: string): Promise<void>;
	removeBannedGifter(gifterName: string): Promise<boolean>;
	isBannedGifter(gifterName: string): Promise<boolean>;
}

export interface TokenRepositoryContract {
	getLatestToken(): Promise<AccessToken | null>;
	upsertToken(token: AccessToken): Promise<void>;
}

export interface BroadcastNotifierContract {
	sendTwitch(message: string): Promise<void>;
	sendDiscordBroadcast(message: string): Promise<void>;
}

export interface ChannelNotifierContract {
	sendDiscordChannel(channelId: string, message: string): Promise<void>;
}

export interface MessageThrottleContract {
	run<T>(operation: () => Promise<T>): Promise<T>;
}

export interface ImageGeneratorContract {
	generate(input: {
		jobId: string;
		userName: string;
		userDisplayName: string;
		theme: string | undefined;
		style: string | null;
		attempt: number;
		metadata: Record<string, unknown>;
		getMeaning: (userName: string) => Promise<string>;
		onProviderCall: (providerCall: ProviderCallEnvelope) => Promise<void>;
	}): Promise<GenerationResult | { success: false; message: string; attempt: number }>;
}
