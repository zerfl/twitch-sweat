import type { GenerationWriteRepositoryContract, JobWriteRepositoryContract } from '../contracts';
import type { GenerationJobPayload, TriggerEventRecord } from '../../domain/types';

interface EnqueueDeps {
	jobWriteRepository: JobWriteRepositoryContract;
	generationWriteRepository: GenerationWriteRepositoryContract;
	maxRetries: number;
}

export class EnqueueGenerationUseCase {
	constructor(private readonly deps: EnqueueDeps) {}

	async enqueue(payload: GenerationJobPayload, event: TriggerEventRecord, priority: number = 100): Promise<string> {
		const jobId = await this.deps.jobWriteRepository.enqueue(payload, this.deps.maxRetries, priority);
		await this.deps.generationWriteRepository.createEvent(jobId, event);
		await this.deps.generationWriteRepository.appendAudit(jobId, {
			step: 'job.enqueued',
			level: 'info',
			message: 'Job enqueued',
			metadata: {
				kind: payload.kind,
				trigger: event.trigger,
				source: event.source,
			},
		});
		return jobId;
	}
}
