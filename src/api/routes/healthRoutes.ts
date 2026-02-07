import { Router } from 'express';
import type { JobQueryRepositoryContract } from '../../application/contracts';

interface HealthRoutesDeps {
	jobQueryRepository: JobQueryRepositoryContract;
}

export function createHealthRoutes(deps: HealthRoutesDeps): Router {
	const router = Router();

	router.get('/health/live', (_req, res) => {
		res.status(200).json({ ok: true });
	});

	router.get('/health/ready', async (_req, res) => {
		const pendingJobs = await deps.jobQueryRepository.getActivePendingCount();
		res.status(200).json({ ok: true, pendingJobs });
	});

	return router;
}
