import express from 'express';
import type { Server } from 'http';
import type { GenerationQueryRepositoryContract, JobQueryRepositoryContract } from '../application/contracts';
import { createBearerAuthMiddleware } from './middleware/auth';
import { createGenerationRoutes } from './routes/generationRoutes';
import { createHealthRoutes } from './routes/healthRoutes';
import { createJobRoutes } from './routes/jobRoutes';

interface ApiServerDeps {
	generationQueryRepository: GenerationQueryRepositoryContract;
	jobQueryRepository: JobQueryRepositoryContract;
	internalApiBearerToken: string;
	port: number;
}

export class ApiServer {
	private readonly app = express();
	private server: Server | null = null;

	constructor(private readonly deps: ApiServerDeps) {
		this.app.use(express.json());
		this.app.use(createHealthRoutes({ jobQueryRepository: deps.jobQueryRepository }));
		this.app.use('/api', createBearerAuthMiddleware(deps.internalApiBearerToken));
		this.app.use('/api', createGenerationRoutes({ generationQueryRepository: deps.generationQueryRepository }));
		this.app.use('/api', createJobRoutes({ jobQueryRepository: deps.jobQueryRepository }));
	}

	async start(): Promise<void> {
		await new Promise<void>((resolve) => {
			this.server = this.app.listen(this.deps.port, () => resolve());
		});
	}

	async stop(): Promise<void> {
		if (!this.server) {
			return;
		}
		await new Promise<void>((resolve, reject) => {
			this.server?.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve();
			});
		});
	}
}
