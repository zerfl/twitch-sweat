import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import type {
	CompletionStats,
	JobQueryRepositoryContract,
	OperationalSnapshot,
	StoredJob,
} from '../../application/contracts';
import type { JobStatus } from '../../domain/types';
import type { DbClient } from '../db/client';
import { generationJobsTable } from '../db/schema';

export class JobQueryRepository implements JobQueryRepositoryContract {
	constructor(private readonly db: DbClient) {}

	async getActivePendingCount(): Promise<number> {
		const rows = await this.db
			.select({ count: sql<number>`count(*)::int` })
			.from(generationJobsTable)
			.where(and(eq(generationJobsTable.status, 'pending'), lte(generationJobsTable.nextRunAt, new Date())));
		return rows[0]?.count ?? 0;
	}

	async countByStatus(status: JobStatus): Promise<number> {
		const rows = await this.db
			.select({ count: sql<number>`count(*)::int` })
			.from(generationJobsTable)
			.where(eq(generationJobsTable.status, status));
		return rows[0]?.count ?? 0;
	}

	async getMostRecentProcessingJob(): Promise<StoredJob | null> {
		const rows = await this.db
			.select()
			.from(generationJobsTable)
			.where(eq(generationJobsTable.status, 'processing'))
			.orderBy(desc(generationJobsTable.updatedAt))
			.limit(1);
		return (rows[0] as StoredJob | undefined) ?? null;
	}

	async getOperationalSnapshot(): Promise<OperationalSnapshot> {
		const now = new Date();
		const aggregateResult = await this.db.execute(sql`
			select
				count(*) filter (where status = 'pending')::int as pending_count,
				count(*) filter (where status = 'pending' and next_run_at <= ${now})::int as ready_pending_count,
				count(*) filter (where status = 'processing')::int as processing_count,
				min(created_at) filter (where status = 'pending') as oldest_pending_created_at,
				min(locked_at) filter (where status = 'processing') as oldest_processing_locked_at
			from generation_jobs
		`);
		const aggregateRow = aggregateResult.rows[0] as
			| {
					pending_count: number;
					ready_pending_count: number;
					processing_count: number;
					oldest_pending_created_at: Date | string | null;
					oldest_processing_locked_at: Date | string | null;
			  }
			| undefined;

		const sampleRows = await this.db
			.select()
			.from(generationJobsTable)
			.where(eq(generationJobsTable.status, 'processing'))
			.orderBy(desc(generationJobsTable.updatedAt))
			.limit(1);
		const sampleProcessingJob = (sampleRows[0] as StoredJob | undefined) ?? null;

		return {
			pendingCount: aggregateRow?.pending_count ?? 0,
			readyPendingCount: aggregateRow?.ready_pending_count ?? 0,
			processingCount: aggregateRow?.processing_count ?? 0,
			oldestPendingCreatedAt: this.toDateOrNull(aggregateRow?.oldest_pending_created_at),
			oldestProcessingLockedAt: this.toDateOrNull(aggregateRow?.oldest_processing_locked_at),
			sampleProcessingJob,
		};
	}

	async getCompletionStatsSince(since: Date): Promise<CompletionStats> {
		const result = await this.db.execute(sql`
			select
				count(*) filter (where status = 'succeeded' and updated_at >= ${since})::int as succeeded_count,
				count(*) filter (where status = 'failed' and updated_at >= ${since})::int as failed_count,
				avg(attempt_count) filter (
					where status in ('succeeded', 'failed')
						and updated_at >= ${since}
				) as average_attempts
			from generation_jobs
		`);
		const row = result.rows[0] as
			| {
					succeeded_count: number;
					failed_count: number;
					average_attempts: number | string | null;
			  }
			| undefined;

		return {
			succeededCount: row?.succeeded_count ?? 0,
			failedCount: row?.failed_count ?? 0,
			averageAttempts: this.toNumberOrNull(row?.average_attempts),
		};
	}

	async getById(jobId: string): Promise<StoredJob | null> {
		const rows = await this.db
			.select()
			.from(generationJobsTable)
			.where(eq(generationJobsTable.id, jobId))
			.limit(1);
		return (rows[0] as StoredJob | undefined) ?? null;
	}

	async list(params: { limit: number; cursor?: string; status?: JobStatus }): Promise<StoredJob[]> {
		const base = this.db
			.select()
			.from(generationJobsTable)
			.orderBy(asc(generationJobsTable.createdAt))
			.limit(params.limit);

		if (params.status && params.cursor) {
			return (await base
				.where(and(eq(generationJobsTable.status, params.status), lte(generationJobsTable.id, params.cursor)))
				.execute()) as unknown as StoredJob[];
		}
		if (params.status) {
			return (await base.where(eq(generationJobsTable.status, params.status)).execute()) as unknown as StoredJob[];
		}
		if (params.cursor) {
			return (await base.where(lte(generationJobsTable.id, params.cursor)).execute()) as unknown as StoredJob[];
		}
		return (await base.execute()) as unknown as StoredJob[];
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

	private toNumberOrNull(value: number | string | null | undefined): number | null {
		if (value === null || value === undefined) {
			return null;
		}
		if (typeof value === 'number') {
			return Number.isFinite(value) ? value : null;
		}
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
}
