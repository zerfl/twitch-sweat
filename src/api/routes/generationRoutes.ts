import { Router } from 'express';
import type { GenerationQueryRepositoryContract } from '../../application/contracts';
import { parseIntWithBounds, parseOptionalDate, parseOptionalInt } from '../http/queryParsers';
import { toPublicCloudflareUrlFromStored } from '../../utils/imageUrlPolicy';

interface GenerationRoutesDeps {
	generationQueryRepository: GenerationQueryRepositoryContract;
}

export function createGenerationRoutes(deps: GenerationRoutesDeps): Router {
	const router = Router();

	const withPublicImageUrl = (row: Record<string, unknown>): Record<string, unknown> => {
		const storedImageUrl = row.imageUrl;
		if (typeof storedImageUrl !== 'string') {
			return row;
		}
		return {
			...row,
			imageUrl: toPublicCloudflareUrlFromStored(storedImageUrl),
		};
	};

	router.get('/generations', async (req, res) => {
		const limit = parseIntWithBounds(req.query.limit as string | undefined, 25, 1, 100);
		const cursor = parseOptionalInt(req.query.cursor as string | undefined);
		const dateFrom = parseOptionalDate(req.query.dateFrom as string | undefined);
		const dateTo = parseOptionalDate(req.query.dateTo as string | undefined);
		const username = typeof req.query.username === 'string' ? req.query.username : undefined;
		const trigger = typeof req.query.trigger === 'string' ? req.query.trigger : undefined;

		const query: {
			limit: number;
			cursor?: number;
			username?: string;
			trigger?: string;
			dateFrom?: Date;
			dateTo?: Date;
		} = { limit };
		if (cursor !== null) {
			query.cursor = cursor;
		}
		if (username) {
			query.username = username;
		}
		if (trigger) {
			query.trigger = trigger;
		}
		if (dateFrom) {
			query.dateFrom = dateFrom;
		}
		if (dateTo) {
			query.dateTo = dateTo;
		}

		const rows = await deps.generationQueryRepository.listGenerations(query);
		res.status(200).json({ items: rows.map((row) => withPublicImageUrl(row)) });
	});

	router.get('/generations/:id', async (req, res) => {
		const id = parseOptionalInt(req.params.id);
		if (!id) {
			res.status(400).json({ error: 'Invalid id' });
			return;
		}
		const row = await deps.generationQueryRepository.getGenerationById(id);
		if (!row) {
			res.status(404).json({ error: 'Not found' });
			return;
		}
		res.status(200).json(withPublicImageUrl(row));
	});

	router.get('/events', async (req, res) => {
		const limit = parseIntWithBounds(req.query.limit as string | undefined, 50, 1, 200);
		const jobId = typeof req.query.jobId === 'string' && req.query.jobId.trim().length > 0 ? req.query.jobId : undefined;
		const rows = await deps.generationQueryRepository.listEvents({ limit, ...(jobId ? { jobId } : {}) });
		res.status(200).json({ items: rows });
	});

	router.get('/provider-calls', async (req, res) => {
		const limit = parseIntWithBounds(req.query.limit as string | undefined, 50, 1, 200);
		const jobId = typeof req.query.jobId === 'string' && req.query.jobId.trim().length > 0 ? req.query.jobId : undefined;
		const rows = await deps.generationQueryRepository.listProviderCalls({ limit, ...(jobId ? { jobId } : {}) });
		res.status(200).json({ items: rows });
	});

	router.get('/audit', async (req, res) => {
		const limit = parseIntWithBounds(req.query.limit as string | undefined, 50, 1, 200);
		const jobId = typeof req.query.jobId === 'string' && req.query.jobId.trim().length > 0 ? req.query.jobId : undefined;
		const rows = await deps.generationQueryRepository.listAudit({ limit, ...(jobId ? { jobId } : {}) });
		res.status(200).json({ items: rows });
	});

	return router;
}
