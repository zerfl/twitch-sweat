export interface BootstrapLogger {
	log: (message: string) => void;
}

const defaultLogger: BootstrapLogger = console;

function formatDurationMs(startedAt: number): number {
	return Date.now() - startedAt;
}

export function logBootstrapEvent(stepName: string, logger: BootstrapLogger = defaultLogger): void {
	logger.log(`[bootstrap] ${stepName}`);
}

export async function runBootstrapStep<T>(
	stepName: string,
	action: () => Promise<T> | T,
	logger: BootstrapLogger = defaultLogger,
): Promise<T> {
	const startedAt = Date.now();
	logger.log(`[bootstrap] ${stepName}:start`);

	try {
		const result = await action();
		logger.log(`[bootstrap] ${stepName}:ok (${formatDurationMs(startedAt)}ms)`);
		return result;
	} catch (error) {
		logger.log(`[bootstrap] ${stepName}:failed (${formatDurationMs(startedAt)}ms)`);
		throw error;
	}
}
