import OpenAI from 'openai';
import { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

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

	async getChatCompletion(
		messages: OpenAI.ChatCompletionMessageParam[],
		options?: {
			length?: number;
			stop?: string[];
		},
	): Promise<string>;

	async getChatCompletion<T extends z.ZodType>(
		messages: OpenAI.ChatCompletionMessageParam[],
		options: {
			length?: number;
			stop?: string[];
			schema: T;
			schemaName: string;
		},
	): Promise<z.infer<T>>;

	async getChatCompletion<T extends z.ZodType>(
		messages: OpenAI.ChatCompletionMessageParam[],
		options: {
			length?: number;
			stop?: string[];
			schema?: T;
			schemaName?: string;
		} = {},
	): Promise<string | z.infer<T>> {
		const { length = 400, stop = [], schema, schemaName } = options;

		const completionRequest: OpenAI.ChatCompletionCreateParams = {
			messages: messages,
			model: this.model,
			temperature: 1,
			max_tokens: length,
			store: true,
			metadata: {
				source: 'twitch',
				product: 'ai-images',
			},
			stop: stop.length ? stop : undefined,
		};

		if (schema && schemaName) {
			completionRequest.response_format = zodResponseFormat(schema, schemaName);
		}

		const completion = await this.client.beta.chat.completions.parse(completionRequest);

		if (!completion.choices[0]?.message) {
			throw new Error('No message received from OpenAI');
		}

		const message = completion.choices[0].message;

		if (schema) {
			if ('parsed' in message && message.parsed) {
				return message.parsed as z.infer<T>;
			} else if ('refusal' in message && message.refusal) {
				throw new Error(`AI refused to generate a response: ${message.refusal}`);
			} else {
				throw new Error('Failed to parse structured output');
			}
		}

		if (!message.content) {
			throw new Error('No content received from OpenAI');
		}

		return message.content;
	}

	async generateImage(params: OpenAI.Images.ImageGenerateParams): Promise<OpenAI.Images.ImagesResponse> {
		return this.client.images.generate(params);
	}
}
