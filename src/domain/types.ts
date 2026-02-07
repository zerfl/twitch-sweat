export type JobStatus = 'pending' | 'processing' | 'succeeded' | 'failed';

export type JobKind =
	| 'subscription'
	| 'custom_twitch'
	| 'custom_discord'
	| 'test_generation';

export interface GenerationJobPayload {
	kind: JobKind;
	broadcasterName: string;
	targetUserName: string;
	targetDisplayName: string;
	trigger: string;
	requestUserName?: string;
	isGifting?: boolean;
	style?: string | null;
	metadata?: Record<string, unknown>;
	discordMessageChannelId?: string;
}

export interface GenerationResult {
	success: true;
	imageUrl: string;
	publicImageUrl: string;
	analysis: string;
	finalPrompt: string;
	styleKeyword: string;
	styleName: string;
	structuredOutput: unknown;
	attempt: number;
}

export interface GenerationError {
	success: false;
	message: string;
	attempt: number;
}

export type GenerationOutcome = GenerationResult | GenerationError;

export interface ProviderCallEnvelope {
	provider: 'openai' | 'cloudflare' | 'twitch' | 'discord';
	operation: string;
	requestPayload: unknown;
	responsePayload?: unknown;
	httpStatus?: number;
	latencyMs: number;
	errorMessage?: string;
}

export interface TriggerEventRecord {
	source: 'twitch' | 'discord';
	trigger: string;
	payload: Record<string, unknown>;
	targetUserName: string;
	targetDisplayName: string;
	broadcasterName: string;
}

export interface AuditRecord {
	step: string;
	level: 'info' | 'warn' | 'error';
	message: string;
	metadata?: Record<string, unknown>;
}

export interface UserGenerationRecord {
	image: string;
	analysis: string;
	prompt: string;
	date: string;
}
