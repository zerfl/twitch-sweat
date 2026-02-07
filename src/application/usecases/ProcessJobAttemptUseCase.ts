import type {
	GenerationWriteRepositoryContract,
	ImageGeneratorContract,
	JobWriteRepositoryContract,
	PreferenceRepositoryContract,
	StoredJob,
} from '../contracts';

export type ProcessJobAttemptResult =
	| {
		status: 'succeeded';
		imageUrl: string;
		publicImageUrl: string;
		attemptNumber: number;
	}
	| {
		status: 'failed';
		errorMessage: string;
		attemptNumber: number;
	};

interface ProcessJobAttemptDeps {
	jobWriteRepository: JobWriteRepositoryContract;
	generationWriteRepository: GenerationWriteRepositoryContract;
	preferenceRepository: PreferenceRepositoryContract;
	imageGenerator: ImageGeneratorContract;
}

export class ProcessJobAttemptUseCase {
	constructor(private readonly deps: ProcessJobAttemptDeps) {}

	async execute(job: StoredJob): Promise<ProcessJobAttemptResult> {
		const attemptNumber = job.attemptCount + 1;
		await this.deps.jobWriteRepository.incrementAttempt(job.id);
		const attemptId = await this.deps.generationWriteRepository.createAttempt(job.id, attemptNumber);

		try {
			const theme = await this.deps.preferenceRepository.getTheme();
			const result = await this.deps.imageGenerator.generate({
				jobId: job.id,
				userName: job.payload.targetUserName,
				userDisplayName: job.payload.targetDisplayName,
				theme,
				style: job.payload.style ?? null,
				attempt: attemptNumber,
				metadata: job.payload.metadata ?? {},
				getMeaning: (userName) => this.deps.preferenceRepository.getMeaning(userName),
				onProviderCall: (providerCall) => this.deps.generationWriteRepository.recordProviderCall(job.id, attemptId, providerCall),
			});

			if (!result.success) {
				await this.deps.generationWriteRepository.completeAttempt(attemptId, 'failed', result.message);
				return {
					status: 'failed',
					errorMessage: result.message,
					attemptNumber,
				};
			}

			await this.deps.generationWriteRepository.saveOutput(job.id, {
				broadcasterName: job.payload.broadcasterName,
				targetUserName: job.payload.targetUserName,
				targetDisplayName: job.payload.targetDisplayName,
				theme: theme ?? '',
				result,
			});
			await this.deps.generationWriteRepository.completeAttempt(attemptId, 'succeeded');
			return {
				status: 'succeeded',
				imageUrl: result.imageUrl,
				publicImageUrl: result.publicImageUrl,
				attemptNumber,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			await this.deps.generationWriteRepository.completeAttempt(attemptId, 'failed', errorMessage);
			return {
				status: 'failed',
				errorMessage,
				attemptNumber,
			};
		}
	}
}
