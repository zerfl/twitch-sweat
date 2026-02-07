import { Router } from 'express';
import type { JobQueryRepositoryContract } from '../../application/contracts';
import { parseIntWithBounds } from '../http/queryParsers';

interface JobRoutesDeps {
	jobQueryRepository: JobQueryRepositoryContract;
}

export function createJobRoutes(deps: JobRoutesDeps): Router {
	const router = Router();

	router.get('/jobs', async (req, res) => {
		const limit = parseIntWithBounds(req.query.limit as string | undefined, 25, 1, 100);
		const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
		const status = typeof req.query.status === 'string' ? req.query.status : undefined;
		const query: {
			limit: number;
			cursor?: string;
			status?: 'pending' | 'processing' | 'succeeded' | 'failed';
		} = { limit };
		if (cursor) {
			query.cursor = cursor;
		}
		if (status === 'pending' || status === 'processing' || status === 'succeeded' || status === 'failed') {
			query.status = status;
		}
		const rows = await deps.jobQueryRepository.list(query);
		res.status(200).json({ items: rows });
	});

	return router;
}
