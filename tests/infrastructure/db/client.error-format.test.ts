import { describe, expect, it } from 'vitest';
import {
	createDatabaseOperationError,
	formatDatabaseTarget,
	formatErrorCauseChain,
	getDatabaseTarget,
} from '../../../src/infrastructure/db/client';

describe('db diagnostics helpers', () => {
	it('formats nested error cause chains', () => {
		const dnsError = Object.assign(new Error('dns lookup failed'), { code: 'EAI_AGAIN' });
		const timeoutError = new Error('connection timed out', { cause: dnsError });
		const queryError = new Error('failed query', { cause: timeoutError });

		const lines = formatErrorCauseChain(queryError);

		expect(lines).toHaveLength(3);
		expect(lines[0]).toContain('error: failed query');
		expect(lines[1]).toContain('cause 1: connection timed out');
		expect(lines[2]).toContain('cause 2: dns lookup failed (code=EAI_AGAIN)');
	});

	it('formats DB target details without credentials', () => {
		const target = getDatabaseTarget('postgres://alice:s3cr3t@localhost:5432/sweatling');
		const formatted = formatDatabaseTarget(target);

		expect(formatted).toContain('host=localhost');
		expect(formatted).toContain('port=5432');
		expect(formatted).toContain('database=sweatling');
		expect(formatted).not.toContain('alice');
		expect(formatted).not.toContain('s3cr3t');
	});

	it('includes configured timeout in DB operation errors', () => {
		const error = createDatabaseOperationError(
			'connection preflight',
			{
				databaseUrl: 'postgres://alice:s3cr3t@localhost:5432/sweatling',
				connectTimeoutMs: 4321,
			},
			new Error('connection timed out'),
		);

		expect(error.message).toContain('timeoutMs=4321');
		expect(error.message).toContain('host=localhost port=5432 database=sweatling');
		expect(error.message).not.toContain('alice');
		expect(error.message).not.toContain('s3cr3t');
	});
});
