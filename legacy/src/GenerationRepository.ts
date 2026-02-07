import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import type {
	AuditRecord,
	GenerationResult,
	ProviderCallEnvelope,
	TriggerEventRecord,
	UserGenerationRecord,
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

export class GenerationRepository {
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
		record: UserGenerationRecord,
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

	async listGenerations(params: {
		limit: number;
		cursor?: number;
		username?: string;
		trigger?: string;
		dateFrom?: Date;
		dateTo?: Date;
	}): Promise<typeof generationOutputsTable.$inferSelect[]> {
		const clauses: SQL[] = [];
		if (params.cursor) {
			clauses.push(lte(generationOutputsTable.id, params.cursor));
		}
		if (params.username) {
			clauses.push(eq(generationOutputsTable.targetUserName, params.username.toLowerCase()));
		}
		if (params.dateFrom) {
			clauses.push(gte(generationOutputsTable.createdAt, params.dateFrom));
		}
		if (params.dateTo) {
			clauses.push(lte(generationOutputsTable.createdAt, params.dateTo));
		}

		if (params.trigger) {
			const eventRows = await this.db
				.select({ jobId: generationEventsTable.jobId })
				.from(generationEventsTable)
				.where(eq(generationEventsTable.trigger, params.trigger));
			const ids = eventRows.map((row) => row.jobId);
			if (ids.length === 0) {
				return [];
			}
			clauses.push(inArray(generationOutputsTable.jobId, ids));
		}

		const query = this.db
			.select()
			.from(generationOutputsTable)
			.orderBy(desc(generationOutputsTable.createdAt))
			.limit(params.limit);

		if (clauses.length === 0) {
			return await query;
		}
		return await query.where(and(...clauses));
	}

	async getGenerationById(id: number): Promise<typeof generationOutputsTable.$inferSelect | null> {
		const rows = await this.db
			.select()
			.from(generationOutputsTable)
			.where(eq(generationOutputsTable.id, id))
			.limit(1);
		return rows[0] ?? null;
	}

	async listEvents(limit: number): Promise<typeof generationEventsTable.$inferSelect[]> {
		return this.db.select().from(generationEventsTable).orderBy(desc(generationEventsTable.createdAt)).limit(limit);
	}

	async listProviderCalls(limit: number): Promise<typeof providerCallsTable.$inferSelect[]> {
		return this.db.select().from(providerCallsTable).orderBy(desc(providerCallsTable.createdAt)).limit(limit);
	}
}
