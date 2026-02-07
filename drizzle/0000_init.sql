CREATE TYPE job_status AS ENUM ('pending', 'processing', 'succeeded', 'failed');
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS app_config (
	id bigint PRIMARY KEY,
	broadcaster_name varchar(255) NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS twitch_tokens (
	id bigserial PRIMARY KEY,
	access_token text NOT NULL,
	refresh_token text,
	expires_in integer,
	obtainment_timestamp integer NOT NULL,
	scope jsonb NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS ignore_users (
	id bigserial PRIMARY KEY,
	username_canonical varchar(255) NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS ignore_users_username_unique ON ignore_users (username_canonical);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS user_meanings (
	id bigserial PRIMARY KEY,
	username_canonical varchar(255) NOT NULL,
	meaning text NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS user_meanings_username_unique ON user_meanings (username_canonical);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS broadcaster_themes (
	id bigserial PRIMARY KEY,
	broadcaster_name varchar(255) NOT NULL,
	theme text NOT NULL,
	updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS broadcaster_themes_broadcaster_unique ON broadcaster_themes (broadcaster_name);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS banned_gifters (
	id bigserial PRIMARY KEY,
	broadcaster_name varchar(255) NOT NULL,
	username_canonical varchar(255) NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS banned_gifters_broadcaster_user_unique
	ON banned_gifters (broadcaster_name, username_canonical);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS generation_jobs (
	id varchar(64) PRIMARY KEY,
	status job_status NOT NULL DEFAULT 'pending',
	attempt_count integer NOT NULL DEFAULT 0,
	max_retries integer NOT NULL DEFAULT 3,
	priority integer NOT NULL DEFAULT 100,
	next_run_at timestamptz NOT NULL DEFAULT now(),
	payload jsonb NOT NULL,
	last_error text,
	locked_at timestamptz,
	created_at timestamptz NOT NULL DEFAULT now(),
	updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS generation_jobs_next_run_idx ON generation_jobs (status, next_run_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS generation_events (
	id bigserial PRIMARY KEY,
	job_id varchar(64) NOT NULL,
	source varchar(32) NOT NULL,
	trigger varchar(128) NOT NULL,
	payload jsonb NOT NULL,
	target_user_name varchar(255) NOT NULL,
	target_display_name varchar(255) NOT NULL,
	broadcaster_name varchar(255) NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS generation_events_job_idx ON generation_events (job_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS generation_attempts (
	id bigserial PRIMARY KEY,
	job_id varchar(64) NOT NULL,
	attempt_number integer NOT NULL,
	status varchar(32) NOT NULL,
	started_at timestamptz NOT NULL DEFAULT now(),
	ended_at timestamptz,
	error_message text,
	created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS generation_attempts_job_idx ON generation_attempts (job_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS provider_calls (
	id bigserial PRIMARY KEY,
	job_id varchar(64) NOT NULL,
	attempt_id bigint,
	provider varchar(32) NOT NULL,
	operation varchar(128) NOT NULL,
	request_payload jsonb NOT NULL,
	response_payload jsonb,
	http_status integer,
	latency_ms integer NOT NULL,
	error_message text,
	created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS provider_calls_job_idx ON provider_calls (job_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS provider_calls_provider_idx ON provider_calls (provider, created_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS generation_outputs (
	id bigserial PRIMARY KEY,
	job_id varchar(64) NOT NULL,
	broadcaster_name varchar(255) NOT NULL,
	target_user_name varchar(255) NOT NULL,
	target_display_name varchar(255) NOT NULL,
	image_url text NOT NULL,
	analysis_text text NOT NULL,
	final_prompt text NOT NULL,
	style_keyword varchar(64) NOT NULL,
	style_name varchar(255) NOT NULL,
	theme text NOT NULL,
	structured_output jsonb NOT NULL,
	created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS generation_outputs_job_unique ON generation_outputs (job_id);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS generation_outputs_target_user_idx ON generation_outputs (target_user_name, created_at);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS outbound_messages (
	id bigserial PRIMARY KEY,
	job_id varchar(64) NOT NULL,
	platform varchar(32) NOT NULL,
	target varchar(255) NOT NULL,
	payload jsonb NOT NULL,
	success boolean NOT NULL,
	error_message text,
	created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS outbound_messages_job_idx ON outbound_messages (job_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS audit_log (
	id bigserial PRIMARY KEY,
	job_id varchar(64),
	step varchar(128) NOT NULL,
	level varchar(16) NOT NULL,
	message text NOT NULL,
	metadata jsonb,
	created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS audit_log_job_idx ON audit_log (job_id, created_at);
