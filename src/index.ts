import { startApp } from './bootstrap/startApp';
import { formatErrorCauseChain } from './infrastructure/db/client';

async function main(): Promise<void> {
	const app = await startApp();

	const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
		console.log(`Received ${signal}, shutting down...`);
		await app.stop();
		process.exit(0);
	};

	process.on('SIGINT', () => {
		void shutdown('SIGINT');
	});
	process.on('SIGTERM', () => {
		void shutdown('SIGTERM');
	});
}

main().catch((error: unknown) => {
	if (error instanceof Error) {
		console.error('Fatal startup error');
		for (const line of formatErrorCauseChain(error)) {
			console.error(line);
		}
		console.error(error.stack);
	} else {
		console.error(error);
	}
	process.exitCode = 1;
});
