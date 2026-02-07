import {
	bigint,
	bigserial,
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	varchar,
} from 'drizzle-orm/pg-core';
import type { GenerationJobPayload, JobStatus } from '../../domain/types';

export const jobStatusEnum = pgEnum('job_status', ['pending', 'processing', 'succeeded', 'failed']);

export const appConfigTable = pgTable('app_config', {
	id: bigserial('id', { mode: 'number' }).primaryKey(),
	broadcasterName: varchar('broadcaster_name', { length: 255 }).notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const twitchTokensTable = pgTable('twitch_tokens', {
	id: bigserial('id', { mode: 'number' }).primaryKey(),
	accessToken: text('access_token').notNull(),
	refreshToken: text('refresh_token'),
	expiresIn: integer('expires_in'),
	obtainmentTimestamp: bigint('obtainment_timestamp', { mode: 'number' }).notNull(),
	scope: jsonb('scope').$type<string[]>().notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const ignoreUsersTable = pgTable(
	'ignore_users',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		usernameCanonical: varchar('username_canonical', { length: 255 }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		ignoreUserUniqueIdx: uniqueIndex('ignore_users_username_unique').on(table.usernameCanonical),
	}),
);

export const userMeaningsTable = pgTable(
	'user_meanings',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		usernameCanonical: varchar('username_canonical', { length: 255 }).notNull(),
		meaning: text('meaning').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		meaningUniqueIdx: uniqueIndex('user_meanings_username_unique').on(table.usernameCanonical),
	}),
);

export const broadcasterThemesTable = pgTable(
	'broadcaster_themes',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		broadcasterName: varchar('broadcaster_name', { length: 255 }).notNull(),
		theme: text('theme').notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		themeUniqueIdx: uniqueIndex('broadcaster_themes_broadcaster_unique').on(table.broadcasterName),
	}),
);

export const bannedGiftersTable = pgTable(
	'banned_gifters',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		broadcasterName: varchar('broadcaster_name', { length: 255 }).notNull(),
		usernameCanonical: varchar('username_canonical', { length: 255 }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		bannedGifterUniqueIdx: uniqueIndex('banned_gifters_broadcaster_user_unique').on(
			table.broadcasterName,
			table.usernameCanonical,
		),
	}),
);

export const generationJobsTable = pgTable(
	'generation_jobs',
	{
		id: varchar('id', { length: 64 }).primaryKey(),
		status: jobStatusEnum('status').$type<JobStatus>().notNull().default('pending'),
		attemptCount: integer('attempt_count').notNull().default(0),
		maxRetries: integer('max_retries').notNull().default(3),
		priority: integer('priority').notNull().default(100),
		nextRunAt: timestamp('next_run_at', { withTimezone: true }).defaultNow().notNull(),
		payload: jsonb('payload').$type<GenerationJobPayload>().notNull(),
		lastError: text('last_error'),
		lockedAt: timestamp('locked_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		nextRunIdx: index('generation_jobs_next_run_idx').on(table.status, table.nextRunAt),
	}),
);

export const generationEventsTable = pgTable(
	'generation_events',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		jobId: varchar('job_id', { length: 64 }).notNull(),
		source: varchar('source', { length: 32 }).notNull(),
		trigger: varchar('trigger', { length: 128 }).notNull(),
		payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
		targetUserName: varchar('target_user_name', { length: 255 }).notNull(),
		targetDisplayName: varchar('target_display_name', { length: 255 }).notNull(),
		broadcasterName: varchar('broadcaster_name', { length: 255 }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		eventsJobIdx: index('generation_events_job_idx').on(table.jobId),
	}),
);

export const generationAttemptsTable = pgTable(
	'generation_attempts',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		jobId: varchar('job_id', { length: 64 }).notNull(),
		attemptNumber: integer('attempt_number').notNull(),
		status: varchar('status', { length: 32 }).notNull(),
		startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
		endedAt: timestamp('ended_at', { withTimezone: true }),
		errorMessage: text('error_message'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		attemptJobIdx: index('generation_attempts_job_idx').on(table.jobId),
	}),
);

export const providerCallsTable = pgTable(
	'provider_calls',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		jobId: varchar('job_id', { length: 64 }).notNull(),
		attemptId: integer('attempt_id'),
		provider: varchar('provider', { length: 32 }).notNull(),
		operation: varchar('operation', { length: 128 }).notNull(),
		requestPayload: jsonb('request_payload').$type<unknown>().notNull(),
		responsePayload: jsonb('response_payload').$type<unknown>(),
		httpStatus: integer('http_status'),
		latencyMs: integer('latency_ms').notNull(),
		errorMessage: text('error_message'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		providerCallJobIdx: index('provider_calls_job_idx').on(table.jobId),
		providerCallProviderIdx: index('provider_calls_provider_idx').on(table.provider, table.createdAt),
	}),
);

export const generationOutputsTable = pgTable(
	'generation_outputs',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		jobId: varchar('job_id', { length: 64 }).notNull(),
		broadcasterName: varchar('broadcaster_name', { length: 255 }).notNull(),
		targetUserName: varchar('target_user_name', { length: 255 }).notNull(),
		targetDisplayName: varchar('target_display_name', { length: 255 }).notNull(),
		imageUrl: text('image_url').notNull(),
		analysisText: text('analysis_text').notNull(),
		finalPrompt: text('final_prompt').notNull(),
		styleKeyword: varchar('style_keyword', { length: 64 }).notNull(),
		styleName: varchar('style_name', { length: 255 }).notNull(),
		theme: text('theme').notNull(),
		structuredOutput: jsonb('structured_output').$type<unknown>().notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		generationOutputJobUniqueIdx: uniqueIndex('generation_outputs_job_unique').on(table.jobId),
		generationOutputUserIdx: index('generation_outputs_target_user_idx').on(table.targetUserName, table.createdAt),
	}),
);

export const outboundMessagesTable = pgTable(
	'outbound_messages',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		jobId: varchar('job_id', { length: 64 }).notNull(),
		platform: varchar('platform', { length: 32 }).notNull(),
		target: varchar('target', { length: 255 }).notNull(),
		payload: jsonb('payload').$type<unknown>().notNull(),
		success: boolean('success').notNull(),
		errorMessage: text('error_message'),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		outboundJobIdx: index('outbound_messages_job_idx').on(table.jobId),
	}),
);

export const auditLogTable = pgTable(
	'audit_log',
	{
		id: bigserial('id', { mode: 'number' }).primaryKey(),
		jobId: varchar('job_id', { length: 64 }),
		step: varchar('step', { length: 128 }).notNull(),
		level: varchar('level', { length: 16 }).notNull(),
		message: text('message').notNull(),
		metadata: jsonb('metadata').$type<unknown>(),
		createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
	},
	(table) => ({
		auditJobIdx: index('audit_log_job_idx').on(table.jobId, table.createdAt),
	}),
);
