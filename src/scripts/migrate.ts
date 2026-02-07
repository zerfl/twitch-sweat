import { env } from '../env';
import { createDatabaseContext, runMigrations, verifyDatabaseConnection } from '../infrastructure/db/client';

async function main(): Promise<void> {
	const dbDiagnostics = {
		databaseUrl: env.DATABASE_URL,
		connectTimeoutMs: env.DB_CONNECT_TIMEOUT_MS,
	};
	const dbContext = createDatabaseContext(env.DATABASE_URL, env.DB_CONNECT_TIMEOUT_MS);
	try {
		await verifyDatabaseConnection(dbContext.db, dbDiagnostics);
		await runMigrations(dbContext.db, dbDiagnostics);
		console.log('Migrations applied successfully');
	} finally {
		await dbContext.pool.end();
	}
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Migration failed: ${message}`);
	process.exitCode = 1;
});
