import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { JobWriteRepositoryContract, StoredJob } from '../../application/contracts';
import type { GenerationJobPayload } from '../../domain/types';
import type { DbClient } from '../db/client';
import { generationJobsTable } from '../db/schema';

export class JobWriteRepository implements JobWriteRepositoryContract {
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

	async requeueStaleProcessing(olderThan: Date): Promise<number> {
		const result = await this.db.execute(sql`
			update generation_jobs
			set status = 'pending',
				next_run_at = now(),
				locked_at = null,
				last_error = coalesce(last_error, 'Recovered stale processing lock'),
				updated_at = now()
			where status = 'processing'
				and (locked_at is null or locked_at <= ${olderThan})
			returning id
		`);
		return result.rows.length;
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
}
