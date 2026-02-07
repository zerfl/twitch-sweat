import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import * as schema from './schema';

export type DbClient = ReturnType<typeof drizzle<typeof schema>>;

export interface DatabaseTarget {
	host: string;
	port: number;
	database: string;
}

export interface DatabaseOperationDiagnostics {
	databaseUrl: string;
	connectTimeoutMs: number;
}

export interface DatabaseContext {
	pool: Pool;
	db: DbClient;
	target: DatabaseTarget;
	connectTimeoutMs: number;
}

export function createDatabaseContext(databaseUrl: string, connectTimeoutMs: number): DatabaseContext {
	const target = getDatabaseTarget(databaseUrl);
	const pool = new Pool({
		connectionString: databaseUrl,
		connectionTimeoutMillis: connectTimeoutMs,
	});
	const db = drizzle(pool, { schema });
	return { pool, db, target, connectTimeoutMs };
}

export function getDatabaseTarget(databaseUrl: string): DatabaseTarget {
	const parsed = new URL(databaseUrl);
	const parsedPort = Number(parsed.port);
	const port = Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : 5432;
	const databaseName = parsed.pathname.replace(/^\/+/, '') || '(default)';

	return {
		host: parsed.hostname || '(unknown)',
		port,
		database: databaseName,
	};
}

export function formatDatabaseTarget(target: DatabaseTarget): string {
	return `host=${target.host} port=${target.port} database=${target.database}`;
}

export function formatErrorCauseChain(error: unknown): string[] {
	const lines: string[] = [];
	let current: unknown = error;
	const visited = new Set<object>();

	for (let depth = 0; depth < 10; depth += 1) {
		const label = depth === 0 ? 'error' : `cause ${depth}`;
		lines.push(`${label}: ${formatErrorMessage(current)}`);

		if (!isObjectWithCause(current) || current.cause === undefined) {
			break;
		}

		const currentObject = current as object;
		if (visited.has(currentObject)) {
			lines.push(`cause ${depth + 1}: cycle detected`);
			break;
		}
		visited.add(currentObject);

		current = current.cause;
	}

	return lines;
}

export function createDatabaseOperationError(
	operation: string,
	diagnostics: DatabaseOperationDiagnostics,
	cause: unknown,
): Error {
	const target = formatDatabaseTarget(getDatabaseTarget(diagnostics.databaseUrl));
	const message = `Database ${operation} failed (target: ${target}, timeoutMs=${diagnostics.connectTimeoutMs}).`;

	return new Error(message, {
		cause: toError(cause),
	});
}

export async function verifyDatabaseConnection(
	db: DbClient,
	diagnostics: DatabaseOperationDiagnostics,
): Promise<void> {
	try {
		await db.execute(sql`select 1`);
	} catch (error) {
		throw createDatabaseOperationError('connection preflight', diagnostics, error);
	}
}

export async function runMigrations(db: DbClient, diagnostics: DatabaseOperationDiagnostics): Promise<void> {
	try {
		await migrate(db, { migrationsFolder: 'drizzle' });
	} catch (error) {
		throw createDatabaseOperationError('migration', diagnostics, error);
	}
}

function isObjectWithCause(value: unknown): value is { cause?: unknown } {
	return typeof value === 'object' && value !== null && 'cause' in value;
}

function getErrorCode(value: unknown): string | null {
	if (typeof value !== 'object' || value === null) {
		return null;
	}

	const code = (value as { code?: unknown }).code;
	if (typeof code === 'string' && code.length > 0) {
		return code;
	}
	if (typeof code === 'number') {
		return String(code);
	}
	return null;
}

function formatErrorMessage(value: unknown): string {
	if (value instanceof Error) {
		const code = getErrorCode(value);
		return code ? `${value.message} (code=${code})` : value.message;
	}

	if (typeof value === 'string') {
		return value;
	}

	if (typeof value === 'object' && value !== null) {
		try {
			return JSON.stringify(value);
		} catch {
			return '[unserializable error object]';
		}
	}

	return String(value);
}

function toError(value: unknown): Error {
	if (value instanceof Error) {
		return value;
	}
	return new Error(formatErrorMessage(value));
}
