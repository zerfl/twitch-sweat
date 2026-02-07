import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { GenerationJobPayload, JobStatus } from '../../domain/types';
import type { DbClient } from '../db/client';
import { generationJobsTable } from '../db/schema';

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

export class JobRepository {
	constructor(private readonly db: DbClient) {}

	async enqueue(payload: GenerationJobPayload, maxRetries: number, priority: number = 100): Promise<string> {
		const jobId = nanoid(16);
		await this.db.insert(generationJobsTable).values({
			id: jobId,
			status: 'pending',
			attemptCount: 0,
			maxRetries,
			priority,
			nextRunAt: new Date(),
			payload,
		});
		return jobId;
	}

	async claimNextRunnable(): Promise<StoredJob | null> {
		const result = await this.db.execute(sql`
			with candidate as (
				select id
				from generation_jobs
				where status = 'pending'
					and next_run_at <= now()
				order by priority desc, next_run_at asc
				for update skip locked
				limit 1
			)
			update generation_jobs as g
			set status = 'processing',
				locked_at = now(),
				updated_at = now()
			from candidate
			where g.id = candidate.id
			returning g.id, g.status, g.attempt_count as "attemptCount", g.max_retries as "maxRetries", g.priority,
				g.next_run_at as "nextRunAt", g.payload, g.last_error as "lastError", g.locked_at as "lockedAt",
				g.created_at as "createdAt", g.updated_at as "updatedAt"
		`);
		const rows = result.rows as unknown as StoredJob[];
		return rows[0] ?? null;
	}

	async markSucceeded(jobId: string): Promise<void> {
		await this.db
			.update(generationJobsTable)
			.set({
				status: 'succeeded',
				lockedAt: null,
				updatedAt: new Date(),
			})
			.where(eq(generationJobsTable.id, jobId));
	}

	async markFailed(jobId: string, errorMessage: string): Promise<void> {
		await this.db
			.update(generationJobsTable)
			.set({
				status: 'failed',
				lastError: errorMessage,
				lockedAt: null,
				updatedAt: new Date(),
			})
			.where(eq(generationJobsTable.id, jobId));
	}

	async requeue(jobId: string, errorMessage: string, nextRunAt: Date): Promise<void> {
		await this.db
			.update(generationJobsTable)
			.set({
				status: 'pending',
				lastError: errorMessage,
				nextRunAt,
				lockedAt: null,
				updatedAt: new Date(),
			})
			.where(eq(generationJobsTable.id, jobId));
	}

	async incrementAttempt(jobId: string): Promise<void> {
		await this.db
			.update(generationJobsTable)
			.set({
				attemptCount: sql`${generationJobsTable.attemptCount} + 1`,
				updatedAt: new Date(),
			})
			.where(eq(generationJobsTable.id, jobId));
	}

	async getActivePendingCount(): Promise<number> {
		const rows = await this.db
			.select({ count: sql<number>`count(*)::int` })
			.from(generationJobsTable)
			.where(and(eq(generationJobsTable.status, 'pending'), lte(generationJobsTable.nextRunAt, new Date())));
		return rows[0]?.count ?? 0;
	}

	async list(params: { limit: number; cursor?: string; status?: JobStatus }): Promise<StoredJob[]> {
		const base = this.db
			.select()
			.from(generationJobsTable)
			.orderBy(asc(generationJobsTable.createdAt))
			.limit(params.limit);

		if (params.status && params.cursor) {
			return base
				.where(and(eq(generationJobsTable.status, params.status), lte(generationJobsTable.id, params.cursor)))
				.execute();
		}
		if (params.status) {
			return base.where(eq(generationJobsTable.status, params.status)).execute();
		}
		if (params.cursor) {
			return base.where(lte(generationJobsTable.id, params.cursor)).execute();
		}
		return base.execute();
	}
}
