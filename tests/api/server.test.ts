import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiServer } from '../../src/api/server';
import { toPublicCloudflareUrlFromStored } from '../../src/utils/imageUrlPolicy';

function createPort(): number {
	return Math.floor(Math.random() * 1000) + 33000;
}

describe('ApiServer', () => {
	let apiServer: ApiServer | null = null;
	let port = createPort();
	const jobQueryRepository = {
		getActivePendingCount: vi.fn(async () => 7),
		countByStatus: vi.fn(async () => 0),
		getMostRecentProcessingJob: vi.fn(async () => null),
		list: vi.fn(async () => [] as Array<Record<string, unknown>>),
	};
	const generationQueryRepository = {
		listGenerations: vi.fn(async () => [] as Array<Record<string, unknown>>),
		getGenerationById: vi.fn(async () => null as Record<string, unknown> | null),
		listEvents: vi.fn(async () => [] as Array<Record<string, unknown>>),
		listProviderCalls: vi.fn(async () => [] as Array<Record<string, unknown>>),
		listAudit: vi.fn(async () => [] as Array<Record<string, unknown>>),
	};

	beforeEach(() => {
		port = createPort();
		vi.clearAllMocks();
	});

	afterEach(async () => {
		if (apiServer) {
			await apiServer.stop();
		}
		apiServer = null;
	});

	it('stop is safe before start', async () => {
		apiServer = new ApiServer({
			internalApiBearerToken: 'secret-token',
			port,
			jobQueryRepository,
			generationQueryRepository,
		} as never);
		await apiServer.stop();
	});

	it('protects /api routes with bearer auth', async () => {
		apiServer = new ApiServer({
			internalApiBearerToken: 'secret-token',
			port,
			jobQueryRepository,
			generationQueryRepository,
		} as never);
		await apiServer.start();

		const unauthorized = await fetch(`http://127.0.0.1:${port}/api/jobs`);
		expect(unauthorized.status).toBe(401);

		const forbidden = await fetch(`http://127.0.0.1:${port}/api/jobs`, {
			headers: { Authorization: 'Bearer wrong' },
		});
		expect(forbidden.status).toBe(403);
	});

	it('serves health endpoints without auth', async () => {
		apiServer = new ApiServer({
			internalApiBearerToken: 'secret-token',
			port,
			jobQueryRepository,
			generationQueryRepository,
		} as never);
		await apiServer.start();

		const live = await fetch(`http://127.0.0.1:${port}/health/live`);
		expect(live.status).toBe(200);
		const liveJson = await live.json();
		expect(liveJson).toEqual({ ok: true });

		const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
		expect(ready.status).toBe(200);
		const readyJson = (await ready.json()) as { pendingJobs: number };
		expect(readyJson.pendingJobs).toBe(7);
	});

	it('handles generation list/filter and generation by id branches', async () => {
		const storedListUrl = 'https://imagedelivery.net/example/image-id-1/public';
		const storedByIdUrl = 'https://imagedelivery.net/example/image-id-2/public';
		generationQueryRepository.listGenerations.mockResolvedValueOnce([{ id: 1, imageUrl: storedListUrl }]);
		generationQueryRepository.getGenerationById.mockResolvedValueOnce(null);
		generationQueryRepository.getGenerationById.mockResolvedValueOnce({ id: 2, imageUrl: storedByIdUrl });

		apiServer = new ApiServer({
			internalApiBearerToken: 'secret-token',
			port,
			jobQueryRepository,
			generationQueryRepository,
		} as never);
		await apiServer.start();

		const listResponse = await fetch(
			`http://127.0.0.1:${port}/api/generations?limit=10&cursor=9&username=abc&trigger=onSub&dateFrom=2026-01-01&dateTo=2026-01-02`,
			{ headers: { Authorization: 'Bearer secret-token' } },
		);
		expect(listResponse.status).toBe(200);
		const listJson = (await listResponse.json()) as { items: Array<{ imageUrl: string }> };
		expect(listJson.items[0]?.imageUrl).toBe(toPublicCloudflareUrlFromStored(storedListUrl));
		expect(generationQueryRepository.listGenerations).toHaveBeenCalledTimes(1);
		expect(generationQueryRepository.listGenerations).toHaveBeenCalledWith(
			expect.objectContaining({
				limit: 10,
				cursor: 9,
				username: 'abc',
				trigger: 'onSub',
			}),
		);

		const invalidId = await fetch(`http://127.0.0.1:${port}/api/generations/not-a-number`, {
			headers: { Authorization: 'Bearer secret-token' },
		});
		expect(invalidId.status).toBe(400);

		const missing = await fetch(`http://127.0.0.1:${port}/api/generations/1`, {
			headers: { Authorization: 'Bearer secret-token' },
		});
		expect(missing.status).toBe(404);

		const found = await fetch(`http://127.0.0.1:${port}/api/generations/2`, {
			headers: { Authorization: 'Bearer secret-token' },
		});
		expect(found.status).toBe(200);
		const foundJson = (await found.json()) as { imageUrl: string };
		expect(foundJson.imageUrl).toBe(toPublicCloudflareUrlFromStored(storedByIdUrl));

		const simple = await fetch(`http://127.0.0.1:${port}/api/generations`, {
			headers: { Authorization: 'Bearer secret-token' },
		});
		expect(simple.status).toBe(200);
	});

	it('handles jobs/events/provider-calls/audit routes', async () => {
		jobQueryRepository.list.mockResolvedValueOnce([{ id: 'j1' }]);
		generationQueryRepository.listEvents.mockResolvedValueOnce([{ id: 1 }]);
		generationQueryRepository.listProviderCalls.mockResolvedValueOnce([{ id: 2 }]);
		generationQueryRepository.listAudit.mockResolvedValueOnce([{ id: 3 }]);

		apiServer = new ApiServer({
			internalApiBearerToken: 'secret-token',
			port,
			jobQueryRepository,
			generationQueryRepository,
		} as never);
		await apiServer.start();

		const jobs = await fetch(`http://127.0.0.1:${port}/api/jobs?limit=9&cursor=cursor-1&status=invalid`, {
			headers: { Authorization: 'Bearer secret-token' },
		});
		expect(jobs.status).toBe(200);
		expect(jobQueryRepository.list).toHaveBeenCalledWith({ limit: 9, cursor: 'cursor-1' });

		await fetch(`http://127.0.0.1:${port}/api/jobs?limit=2&status=pending`, {
			headers: { Authorization: 'Bearer secret-token' },
		});
		expect(jobQueryRepository.list).toHaveBeenCalledWith({ limit: 2, status: 'pending' });

		const events = await fetch(`http://127.0.0.1:${port}/api/events?limit=5`, {
			headers: { Authorization: 'Bearer secret-token' },
		});
		expect(events.status).toBe(200);
		expect(generationQueryRepository.listEvents).toHaveBeenCalledWith({ limit: 5 });

		const providerCalls = await fetch(`http://127.0.0.1:${port}/api/provider-calls?limit=3&jobId=job-9`, {
			headers: { Authorization: 'Bearer secret-token' },
		});
		expect(providerCalls.status).toBe(200);
		expect(generationQueryRepository.listProviderCalls).toHaveBeenCalledWith({ limit: 3, jobId: 'job-9' });

		const audit = await fetch(`http://127.0.0.1:${port}/api/audit?limit=4&jobId=job-1`, {
			headers: { Authorization: 'Bearer secret-token' },
		});
		expect(audit.status).toBe(200);
		expect(generationQueryRepository.listAudit).toHaveBeenCalledWith({ limit: 4, jobId: 'job-1' });
	});
});
