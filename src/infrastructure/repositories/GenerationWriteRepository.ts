import { eq, sql } from 'drizzle-orm';
import type {
	GenerationWriteRepositoryContract,
} from '../../application/contracts';
import type {
	AuditRecord,
	GenerationResult,
	ProviderCallEnvelope,
	TriggerEventRecord,
} from '../../domain/types';
import type { DbClient } from '../db/client';
import {
	auditLogTable,
	generationAttemptsTable,
	generationEventsTable,
	generationOutputsTable,
	outboundMessagesTable,
	providerCallsTable,
} from '../db/schema';

export class GenerationWriteRepository implements GenerationWriteRepositoryContract {
	constructor(private readonly db: DbClient) {}

	async createEvent(jobId: string, event: TriggerEventRecord): Promise<void> {
		await this.db.insert(generationEventsTable).values({
			jobId,
			source: event.source,
			trigger: event.trigger,
			payload: event.payload,
			targetUserName: event.targetUserName.toLowerCase(),
			targetDisplayName: event.targetDisplayName,
			broadcasterName: event.broadcasterName.toLowerCase(),
		});
	}

	async createAttempt(jobId: string, attemptNumber: number): Promise<number> {
		const row = await this.db
			.insert(generationAttemptsTable)
			.values({
				jobId,
				attemptNumber,
				status: 'started',
				startedAt: new Date(),
			})
			.returning({ id: generationAttemptsTable.id });
		return row[0]!.id;
	}

	async completeAttempt(attemptId: number, status: 'succeeded' | 'failed', errorMessage?: string): Promise<void> {
		await this.db
			.update(generationAttemptsTable)
			.set({
				status,
				endedAt: new Date(),
				errorMessage,
			})
			.where(eq(generationAttemptsTable.id, attemptId));
	}

	async recordProviderCall(jobId: string, attemptId: number, providerCall: ProviderCallEnvelope): Promise<void> {
		await this.db.insert(providerCallsTable).values({
			jobId,
			attemptId,
			provider: providerCall.provider,
			operation: providerCall.operation,
			requestPayload: providerCall.requestPayload,
			responsePayload: providerCall.responsePayload,
			httpStatus: providerCall.httpStatus,
			latencyMs: providerCall.latencyMs,
			errorMessage: providerCall.errorMessage,
		});
	}

	async saveOutput(jobId: string, payload: {
		broadcasterName: string;
		targetUserName: string;
		targetDisplayName: string;
		theme: string;
		result: GenerationResult;
	}): Promise<void> {
		await this.db.insert(generationOutputsTable).values({
			jobId,
			broadcasterName: payload.broadcasterName.toLowerCase(),
			targetUserName: payload.targetUserName.toLowerCase(),
			targetDisplayName: payload.targetDisplayName,
			imageUrl: payload.result.imageUrl,
			analysisText: payload.result.analysis,
			finalPrompt: payload.result.finalPrompt,
			styleKeyword: payload.result.styleKeyword,
			styleName: payload.result.styleName,
			theme: payload.theme,
			structuredOutput: payload.result.structuredOutput,
		});
	}

	async recordOutboundMessage(args: {
		jobId: string;
		platform: 'twitch' | 'discord';
		target: string;
		payload: unknown;
		success: boolean;
		errorMessage?: string;
	}): Promise<void> {
		await this.db.insert(outboundMessagesTable).values({
			jobId: args.jobId,
			platform: args.platform,
			target: args.target,
			payload: args.payload,
			success: args.success,
			errorMessage: args.errorMessage,
		});
	}

	async appendAudit(jobId: string | null, record: AuditRecord): Promise<void> {
		await this.db.insert(auditLogTable).values({
			jobId: jobId ?? undefined,
			step: record.step,
			level: record.level,
			message: record.message,
			metadata: record.metadata,
		});
	}

	async storeUserGenerationRecord(
		broadcasterName: string,
		userName: string,
		record: { image: string; analysis: string; prompt: string; date: string },
		jobId: string,
	): Promise<number> {
		await this.db.insert(generationOutputsTable).values({
			jobId,
			broadcasterName: broadcasterName.toLowerCase(),
			targetUserName: userName.toLowerCase(),
			targetDisplayName: userName,
			imageUrl: record.image,
			analysisText: record.analysis,
			finalPrompt: record.prompt,
			styleKeyword: 'unknown',
			styleName: 'unknown',
			theme: '',
			structuredOutput: {},
		});

		const rows = await this.db
			.select({ count: sql<number>`count(*)::int` })
			.from(generationOutputsTable)
			.where(eq(generationOutputsTable.broadcasterName, broadcasterName.toLowerCase()));
		return rows[0]?.count ?? 0;
	}
}
