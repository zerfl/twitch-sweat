import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

const textResponseSchema = z.object({
	error: z
		.object({
			message: z.string(),
		})
		.nullable()
		.optional(),
	output_text: z.string().optional(),
});

const parsedOutputSchema = z.object({
	output_parsed: z.unknown().optional(),
});

type ResponseInput = Exclude<OpenAI.Responses.ResponseCreateParamsNonStreaming['input'], undefined>;

function extractOutputText(response: unknown): string {
	const parsed = textResponseSchema.safeParse(response);
	if (!parsed.success) {
		throw new Error('OpenAI returned an invalid response payload');
	}
	if (parsed.data.error?.message) {
		throw new Error(`OpenAI Error: ${parsed.data.error.message}`);
	}
	if (typeof parsed.data.output_text !== 'string' || parsed.data.output_text.length === 0) {
		throw new Error('No content received from OpenAI');
	}
	return parsed.data.output_text;
}

export class OpenAIManager {
	private readonly client: OpenAI;
	private readonly model: string = 'gpt-3.5-turbo';

	constructor(apiKey: string, model: string, gateway?: string) {
		const options: { apiKey: string; baseURL?: string } = {
			apiKey,
		};

		if (gateway) {
			options.baseURL = gateway;
		}

		this.model = model;
		this.client = new OpenAI(options);
	}

	public async generateResponse(
		messages: ResponseInput,
		options?: Omit<OpenAI.Responses.ResponseCreateParamsNonStreaming, 'input' | 'model' | 'text' | 'stream'>,
	): Promise<string>;

	public async generateResponse<T extends z.ZodType<unknown, z.ZodTypeDef, unknown>>(
		messages: ResponseInput,
		options: Omit<OpenAI.Responses.ResponseCreateParamsNonStreaming, 'input' | 'model' | 'text' | 'stream'> & {
			schema: T;
			schemaName: string;
		},
	): Promise<z.infer<T>>;

	public async generateResponse<T extends z.ZodType<unknown, z.ZodTypeDef, unknown>>(
		messages: ResponseInput,
		options: Omit<OpenAI.Responses.ResponseCreateParamsNonStreaming, 'input' | 'model' | 'text' | 'stream'> & {
			schema?: T;
			schemaName?: string;
		} = {},
	): Promise<string | z.infer<T>> {
		const { schema, schemaName, ...apiOptions } = options;

		const responseParams: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
			...apiOptions,
			input: messages,
			model: this.model,
			stream: false,
			temperature: options.temperature ?? 1,
			max_output_tokens: options.max_output_tokens ?? 400,
			store: options.store ?? true,
			metadata: {
				source: 'twitch',
				product: 'ai-images',
				...options.metadata,
			},
		};

		if (schema && schemaName) {
			const parsedResponse = await this.client.responses.parse({
				...responseParams,
				text: {
					format: zodTextFormat(schema, schemaName),
				},
			});
			const parsedOutput = parsedOutputSchema.parse(parsedResponse).output_parsed;
			const schemaParsed = schema.safeParse(parsedOutput);
			if (schemaParsed.success) {
				return schemaParsed.data;
			}
			throw new Error('Failed to parse structured output');
		}

		const response = await this.client.responses.create(responseParams);
		return extractOutputText(response);
	}

	async generateImage(params: OpenAI.Images.ImageGenerateParams): Promise<OpenAI.Images.ImagesResponse> {
		const response: unknown = await this.client.images.generate(params);
		return response as OpenAI.Images.ImagesResponse;
	}
}
