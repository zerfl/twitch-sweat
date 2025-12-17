import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

export class OpenAIManager {
	private readonly client: OpenAI;
	private readonly model: string = 'gpt-3.5-turbo';

	constructor(apiKey: string, model: string, gateway?: string) {
		const options: { apiKey: string; baseURL?: string } = {
			apiKey: apiKey,
		};

		if (gateway) {
			options.baseURL = gateway;
		}

		this.model = model;
		this.client = new OpenAI(options);
	}

	public async generateResponse(
		messages: OpenAI.Responses.ResponseCreateParams['input'],
		options?: Omit<OpenAI.Responses.ResponseCreateParams, 'input' | 'model' | 'text' | 'stream'>,
	): Promise<string>;

	public async generateResponse<T extends z.ZodType>(
		messages: OpenAI.Responses.ResponseCreateParams['input'],
		options: Omit<OpenAI.Responses.ResponseCreateParams, 'input' | 'model' | 'text' | 'stream'> & {
			schema: T;
			schemaName: string;
		},
	): Promise<z.infer<T>>;

	public async generateResponse<T extends z.ZodType>(
		messages: OpenAI.Responses.ResponseCreateParams['input'],
		options: Omit<OpenAI.Responses.ResponseCreateParams, 'input' | 'model' | 'text' | 'stream'> & {
			schema?: T;
			schemaName?: string;
		} = {},
	): Promise<string | z.infer<T>> {
		const { schema, schemaName, ...apiOptions } = options;

		const responseParams: OpenAI.Responses.ResponseCreateParams = {
			...apiOptions,
			input: messages,
			model: this.model,
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
			responseParams.text = {
				format: zodTextFormat(schema, schemaName),
			};
		}

		const response = (await this.client.responses.create(responseParams)) as OpenAI.Responses.Response;

		if (response.error) {
			throw new Error(`OpenAI Error: ${response.error.message}`);
		}

		if (schema && schemaName) {
			// With zodTextFormat and client.responses.create, we might need to parse.
			// Actually responses.parse() is preferred if we want auto-parsing.
			// But zodTextFormat is for text.format.
			// If we use responses.parse, we pass responseParams.
			// Let's use parse if schema is present.
			
			const parsedParams = {
				...responseParams,
			};

			const parsedResponse = await this.client.responses.parse(parsedParams);
			
			if (parsedResponse.output_parsed) {
				return parsedResponse.output_parsed as z.infer<T>;
			}

             // Check for refusal in output items
			const firstOutput = parsedResponse.output[0];
            if (firstOutput && 'content' in firstOutput && firstOutput.content) {
				for (const content of firstOutput.content) {
					if (content.type === 'refusal') {
						throw new Error(`AI refused to generate a response: ${content.refusal}`);
					}
				}
			}
			
			throw new Error('Failed to parse structured output');
		}

		if (!response.output_text) {
			throw new Error('No content received from OpenAI');
		}
		
		return response.output_text;
	}

	async generateImage(params: OpenAI.Images.ImageGenerateParams): Promise<OpenAI.Images.ImagesResponse> {
		return this.client.images.generate(params) as Promise<OpenAI.Images.ImagesResponse>;
	}
}
