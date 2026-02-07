ALTER TABLE "twitch_tokens"
ALTER COLUMN "obtainment_timestamp" TYPE bigint
USING "obtainment_timestamp"::bigint;
