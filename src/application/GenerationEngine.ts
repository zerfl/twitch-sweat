import OpenAI from 'openai';
import { nanoid } from 'nanoid';
import {
	DALLE_IMAGE_PROMPT_TEMPLATE,
	DALLE_IMAGE_PROMPT_TEMPLATE_NO_BANNER,
	STRUCTURED_OUTPUT_PROMPT,
	STRUCTURED_OUTPUT_PROMPT_NO_BANNER,
} from '../constants/prompts';
import { DALLE_TEMPLATES, type DalleTemplate } from '../constants/styles';
import { finalSchema, finalSchemaNoBanner } from '../schemas/imageSchemas';
import { CloudflareUploader } from '../utils/CloudflareUploader';
import { buildPublicCloudflareUrl } from '../utils/imageUrlPolicy';
import { OpenAIManager } from '../utils/OpenAIManager';
import { createSystemPrompt } from '../utils/helpers';
import type { GenerationOutcome, ProviderCallEnvelope } from '../domain/types';
import type { ProviderLimiter } from '../infrastructure/throttle/providerLimiter';

interface GenerationEngineArgs {
	jobId: string;
	userName: string;
	userDisplayName: string;
	theme: string | undefined;
	style: string | null;
	attempt: number;
	metadata: Record<string, unknown>;
	getMeaning: (userName: string) => Promise<string>;
	onProviderCall: (providerCall: ProviderCallEnvelope) => Promise<void>;
}

export class GenerationEngine {
	private readonly openAIManager: OpenAIManager;
	private readonly cfUploader: CloudflareUploader;

	constructor(
		private readonly limiter: ProviderLimiter,
		openAiApiKey: string,
		openAiModel: string,
		cloudflareAccountId: string,
		cloudflareApiToken: string,
		cloudflareGateway?: string,
	) {
		this.openAIManager = new OpenAIManager(openAiApiKey, openAiModel, cloudflareGateway);
		this.cfUploader = new CloudflareUploader(cloudflareAccountId, cloudflareApiToken);
	}

	async generate(args: GenerationEngineArgs): Promise<GenerationOutcome> {
		const uniqueId = nanoid(14);

		let template: DalleTemplate | undefined;
		let style = args.style;
		if (style) {
			template = DALLE_TEMPLATES.find((item) => item.keyword.toLowerCase() === style!.toLowerCase());
		}
		if (!template) {
			const templateIndex = Math.floor(Math.random() * DALLE_TEMPLATES.length);
			template = DALLE_TEMPLATES[templateIndex];
		}
		if (!template) {
			return this.failGeneration(args.jobId, args.attempt, uniqueId, 'No style templates configured');
		}
		style = style ?? template.keyword.toLowerCase();

		const userMeaning = await args.getMeaning(args.userName.toLowerCase());
		const queryMessage =
			userMeaning !== args.userName
				? `Literal username: ${args.userDisplayName}\nIntended meaning: ${userMeaning}`
				: `Username: ${args.userDisplayName}`;

		console.log(
			`${this.logPrefix(args.jobId, args.attempt, uniqueId)} generation:start target=${args.userDisplayName} meaning=${userMeaning} template=${template.name} style=${style}`,
		);

		const isRetry = args.attempt > 1;
		const promptTemplate = isRetry ? STRUCTURED_OUTPUT_PROMPT_NO_BANNER : STRUCTURED_OUTPUT_PROMPT;
		const schema = isRetry ? finalSchemaNoBanner : finalSchema;
		const dalleTemplate = isRetry ? DALLE_IMAGE_PROMPT_TEMPLATE_NO_BANNER : DALLE_IMAGE_PROMPT_TEMPLATE;

		const structuredAnalysisMessages: OpenAI.ChatCompletionMessageParam[] = [
			{
				role: 'system',
				content: createSystemPrompt(new Date().toISOString().slice(0, 10), args.theme, promptTemplate),
			},
			{
				role: 'user',
				content: queryMessage,
			},
		];

		const structuredOutput = await this.runProviderCall(
			'openai',
			'responses.structured',
			{
				messages: structuredAnalysisMessages,
				theme: args.theme ?? null,
				schema: isRetry ? 'finalSchemaNoBanner' : 'finalSchema',
			},
			async () => {
				return this.limiter.openai(() => {
					return this.openAIManager.generateResponse(
						structuredAnalysisMessages as unknown as OpenAI.Responses.ResponseInput,
						{
							max_output_tokens: 850,
							schema,
							schemaName: isRetry ? 'finalSchemaNoBanner' : 'finalSchema',
						},
					);
				});
			},
			args.onProviderCall,
			args.jobId,
			args.attempt,
			uniqueId,
		);

		if (!structuredOutput.success) {
			return this.failGeneration(args.jobId, args.attempt, uniqueId, structuredOutput.errorMessage);
		}

		const structuredData = structuredOutput.data;
		const analysisResult = `Literal username: ${args.userDisplayName}\n${JSON.stringify(structuredData, null, 2)}`;

		Object.assign(structuredData.step2, { style: template.description });
		Object.assign(structuredData.step2, { style_description: template.name });

		const imagePrompt = JSON.stringify(structuredData.step2);
		const initialPrompt = dalleTemplate.replace('__DATA__', imagePrompt);

		const finalPrompt = await this.runProviderCall(
			'openai',
			'responses.prompt-refine',
			{ prompt: initialPrompt },
			async () => {
				return this.limiter.openai(() => {
					return this.openAIManager.generateResponse([
						{
							role: 'user',
							content: initialPrompt,
						},
					]);
				});
			},
			args.onProviderCall,
			args.jobId,
			args.attempt,
			uniqueId,
		);

		if (!finalPrompt.success) {
			return this.failGeneration(args.jobId, args.attempt, uniqueId, finalPrompt.errorMessage);
		}

		const imageResult = await this.runProviderCall(
			'openai',
			'images.generate',
			{
				model: 'gpt-image-1.5',
				prompt: finalPrompt.data,
				quality: 'medium',
				size: '1024x1024',
			},
			async () => {
				return this.limiter.image(() => {
					return this.openAIManager.generateImage({
						model: 'gpt-image-1.5',
						prompt: finalPrompt.data,
						quality: 'medium',
						size: '1024x1024',
					});
				});
			},
			args.onProviderCall,
			args.jobId,
			args.attempt,
			uniqueId,
		);

		if (!imageResult.success) {
			return this.failGeneration(args.jobId, args.attempt, uniqueId, imageResult.errorMessage);
		}

		if (!imageResult.data.data || imageResult.data.data.length === 0) {
			return this.failGeneration(args.jobId, args.attempt, uniqueId, 'No image returned');
		}

		const firstImage = imageResult.data.data[0];
		if (!firstImage) {
			return this.failGeneration(args.jobId, args.attempt, uniqueId, 'No image data returned');
		}

		const updatedMetadata = {
			...args.metadata,
			theme: args.theme ?? '',
			style,
		};

		const uploadResult = await this.runProviderCall(
			'cloudflare',
			'images.upload',
			{ updatedMetadata, hasBase64: Boolean(firstImage.b64_json), hasUrl: Boolean(firstImage.url) },
			async () => {
				if (firstImage.b64_json) {
					return this.cfUploader.uploadImageFromBase64(firstImage.b64_json, updatedMetadata);
				}
				if (firstImage.url) {
					return this.cfUploader.uploadImageFromUrl(firstImage.url, updatedMetadata);
				}
				throw new Error('No image data found (url or b64_json)');
			},
			args.onProviderCall,
			args.jobId,
			args.attempt,
			uniqueId,
		);

		if (!uploadResult.success) {
			return this.failGeneration(args.jobId, args.attempt, uniqueId, uploadResult.errorMessage);
		}

		if (!uploadResult.data.success) {
			return this.failGeneration(
				args.jobId,
				args.attempt,
				uniqueId,
				uploadResult.data.errors?.map((e) => e.message).join('; ') ?? 'Upload failed',
			);
		}

		const publicImageUrl = buildPublicCloudflareUrl(uploadResult.data.result.id);
		const storedImageUrl = uploadResult.data.result.variants[0] ?? publicImageUrl;
		console.log(
			`${this.logPrefix(args.jobId, args.attempt, uniqueId)} generation:ok target=${args.userDisplayName} style=${style ?? template.keyword.toLowerCase()} imageStored=${storedImageUrl} imagePublic=${publicImageUrl}`,
		);
		return {
			success: true,
			imageUrl: storedImageUrl,
			publicImageUrl,
			analysis: analysisResult,
			finalPrompt: finalPrompt.data,
			styleKeyword: style ?? template.keyword.toLowerCase(),
			styleName: template.name,
			structuredOutput: structuredData,
			attempt: args.attempt,
		};
	}

	private async runProviderCall<T>(
		provider: ProviderCallEnvelope['provider'],
		operation: string,
		requestPayload: unknown,
		run: () => Promise<T>,
		onProviderCall: (providerCall: ProviderCallEnvelope) => Promise<void>,
		jobId: string,
		attempt: number,
		traceId: string,
	): Promise<{ success: true; data: T } | { success: false; errorMessage: string }> {
		const startedAt = Date.now();
		console.log(`${this.logPrefix(jobId, attempt, traceId)} provider:${operation}:start provider=${provider}`);
		try {
			const data = await run();
			const latencyMs = Date.now() - startedAt;
			await onProviderCall({
				provider,
				operation,
				requestPayload,
				responsePayload: this.redact(data),
				latencyMs,
			});
			console.log(`${this.logPrefix(jobId, attempt, traceId)} provider:${operation}:ok provider=${provider} latencyMs=${latencyMs}`);
			return { success: true, data };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const latencyMs = Date.now() - startedAt;
			await onProviderCall({
				provider,
				operation,
				requestPayload,
				errorMessage: message,
				latencyMs,
			});
			console.log(
				`${this.logPrefix(jobId, attempt, traceId)} provider:${operation}:failed provider=${provider} latencyMs=${latencyMs} error=${message}`,
			);
			return { success: false, errorMessage: message };
		}
	}

	private logPrefix(jobId: string, attempt: number, traceId: string): string {
		return `[generation job=${jobId} attempt=${attempt} trace=${traceId}]`;
	}

	private failGeneration(jobId: string, attempt: number, traceId: string, message: string): { success: false; message: string; attempt: number } {
		console.log(`${this.logPrefix(jobId, attempt, traceId)} generation:failed reason=${message}`);
		return {
			success: false,
			message,
			attempt,
		};
	}

	private redact<T>(payload: T): unknown {
		if (payload === null || payload === undefined) {
			return payload;
		}
		if (typeof payload !== 'object') {
			return payload;
		}
		const serialized = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
		if ('data' in serialized && Array.isArray(serialized.data)) {
			serialized.data = serialized.data.map((entry: unknown): unknown => {
				if (entry && typeof entry === 'object') {
					const copy = { ...(entry as Record<string, unknown>) };
					if ('b64_json' in copy) {
						copy.b64_json = '[redacted]';
					}
					return copy;
				}
				return entry;
			});
		}
		return serialized;
	}
}
