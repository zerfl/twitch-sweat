import { and, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import type {
	GenerationQueryRepositoryContract,
	LatestGenerationEvent,
	ListDiagnosticsQuery,
	ListGenerationsQuery,
	ProviderLatencyStat,
	QueryResultRow,
	TriggerCount,
} from '../../application/contracts';
import type { DbClient } from '../db/client';
import { auditLogTable, generationEventsTable, generationOutputsTable, providerCallsTable } from '../db/schema';

export class GenerationQueryRepository implements GenerationQueryRepositoryContract {
	constructor(private readonly db: DbClient) {}

	async listGenerations(params: ListGenerationsQuery): Promise<QueryResultRow[]> {
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

	async getGenerationById(id: number): Promise<QueryResultRow | null> {
		const rows = await this.db
			.select()
			.from(generationOutputsTable)
			.where(eq(generationOutputsTable.id, id))
			.limit(1);
		return rows[0] ?? null;
	}

	async listEvents(params: ListDiagnosticsQuery): Promise<QueryResultRow[]> {
		const base = this.db.select().from(generationEventsTable).orderBy(desc(generationEventsTable.createdAt)).limit(params.limit);
		if (params.jobId) {
			return await base.where(eq(generationEventsTable.jobId, params.jobId));
		}
		return await base;
	}

	async listProviderCalls(params: ListDiagnosticsQuery): Promise<QueryResultRow[]> {
		const base = this.db.select().from(providerCallsTable).orderBy(desc(providerCallsTable.createdAt)).limit(params.limit);
		if (params.jobId) {
			return await base.where(eq(providerCallsTable.jobId, params.jobId));
		}
		return await base;
	}

	async listAudit(params: ListDiagnosticsQuery): Promise<QueryResultRow[]> {
		const base = this.db.select().from(auditLogTable).orderBy(desc(auditLogTable.createdAt)).limit(params.limit);
		if (params.jobId) {
			return await base.where(eq(auditLogTable.jobId, params.jobId));
		}
		return await base;
	}

	async getTopTriggersSince(since: Date, limit: number): Promise<TriggerCount[]> {
		const boundedLimit = Math.max(1, Math.min(limit, 20));
		const result = await this.db.execute(sql`
			select trigger, count(*)::int as count
			from generation_events
			where created_at >= ${since}
			group by trigger
			order by count desc, trigger asc
			limit ${boundedLimit}
		`);
		return (result.rows as Array<{ trigger: string; count: number }>).map((row) => ({
			trigger: row.trigger,
			count: row.count,
		}));
	}

	async getProviderLatencySince(since: Date): Promise<ProviderLatencyStat[]> {
		const result = await this.db.execute(sql`
			select
				provider,
				operation,
				avg(latency_ms)::int as average_latency_ms,
				count(*)::int as count
			from provider_calls
			where created_at >= ${since}
			group by provider, operation
			order by count desc, operation asc
		`);
		return (result.rows as Array<{ provider: string; operation: string; average_latency_ms: number; count: number }>).map(
			(row) => ({
				provider: row.provider,
				operation: row.operation,
				averageLatencyMs: row.average_latency_ms,
				count: row.count,
			}),
		);
	}

	async getLatestEventForTargetUser(targetUserName: string, broadcasterName: string): Promise<LatestGenerationEvent | null> {
		const rows = await this.db
			.select({
				jobId: generationEventsTable.jobId,
				source: generationEventsTable.source,
				trigger: generationEventsTable.trigger,
				targetUserName: generationEventsTable.targetUserName,
				targetDisplayName: generationEventsTable.targetDisplayName,
				broadcasterName: generationEventsTable.broadcasterName,
				createdAt: generationEventsTable.createdAt,
			})
			.from(generationEventsTable)
			.where(
				and(
					eq(generationEventsTable.targetUserName, targetUserName.toLowerCase()),
					eq(generationEventsTable.broadcasterName, broadcasterName),
				),
			)
			.orderBy(desc(generationEventsTable.createdAt))
			.limit(1);
		return rows[0] ?? null;
	}

	async getProviderLatencyForJob(jobId: string): Promise<ProviderLatencyStat[]> {
		const result = await this.db.execute(sql`
			select
				provider,
				operation,
				avg(latency_ms)::int as average_latency_ms,
				count(*)::int as count
			from provider_calls
			where job_id = ${jobId}
			group by provider, operation
			order by count desc, operation asc
		`);
		return (result.rows as Array<{ provider: string; operation: string; average_latency_ms: number; count: number }>).map(
			(row) => ({
				provider: row.provider,
				operation: row.operation,
				averageLatencyMs: row.average_latency_ms,
				count: row.count,
			}),
		);
	}
}
