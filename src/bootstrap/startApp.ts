import { buildRuntime } from './buildRuntime';

export interface RunningApp {
	stop: () => Promise<void>;
}

export async function startApp(): Promise<RunningApp> {
	const runtime = await buildRuntime();
	await runtime.start();
	return {
		stop: runtime.stop,
	};
}
