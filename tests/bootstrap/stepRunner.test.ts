import { describe, expect, it, vi } from 'vitest';
import { runBootstrapStep } from '../../src/bootstrap/stepRunner';

describe('runBootstrapStep', () => {
	it('logs start and success with duration', async () => {
		const log = vi.fn<(message: string) => void>();

		const value = await runBootstrapStep(
			'db:connect',
			() => 'ok',
			{
				log,
			},
		);

		expect(value).toBe('ok');
		expect(log).toHaveBeenCalledTimes(2);
		expect(log).toHaveBeenNthCalledWith(1, '[bootstrap] db:connect:start');
		expect(log.mock.calls[1]?.[0]).toMatch(/^\[bootstrap\] db:connect:ok \(\d+ms\)$/);
	});

	it('logs failure and rethrows the original error', async () => {
		const log = vi.fn<(message: string) => void>();
		const failure = new Error('boom');

		await expect(
			runBootstrapStep(
				'db:migrate',
				() => {
					throw failure;
				},
				{
					log,
				},
			),
		).rejects.toBe(failure);

		expect(log).toHaveBeenCalledTimes(2);
		expect(log).toHaveBeenNthCalledWith(1, '[bootstrap] db:migrate:start');
		expect(log.mock.calls[1]?.[0]).toMatch(/^\[bootstrap\] db:migrate:failed \(\d+ms\)$/);
	});
});
