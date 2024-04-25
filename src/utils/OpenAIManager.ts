import OpenAI from 'openai';

type ClientKey = 'default' | 'fun';

interface OpenAIManagerClients {
	[key: string]: OpenAI;
}

export class OpenAIManager {
	private readonly clients: OpenAIManagerClients;

	constructor() {
		this.clients = {
			default: new OpenAI({ apiKey: process.env.OPENAI_API_KEY }),
			fun: new OpenAI({ apiKey: process.env.OPENAI_API_KEY_FUN }),
		};
	}

	async getChatCompletion(
		clientKey: ClientKey,
		messages: OpenAI.ChatCompletionMessageParam[],
		length: number = 256,
		stop: string[] = [],
	): Promise<string> {
		const client = this.clients[clientKey];
		if (!client) {
			throw new Error(`Client with key '${clientKey}' does not exist.`);
		}

		const completion = await client.chat.completions.create({
			messages: messages,
			model: 'gpt-3.5-turbo',
			temperature: 1,
			max_tokens: length,
			stop: stop.length ? stop : null,
		});

		if (!completion.choices[0]?.message?.content) {
			throw new Error('No content received from OpenAI');
		}

		return completion.choices[0].message.content;
	}

	async generateImage(
		clientKey: ClientKey,
		params: OpenAI.Images.ImageGenerateParams,
	): Promise<OpenAI.Images.ImagesResponse> {
		const client = this.clients[clientKey];
		if (!client) {
			throw new Error(`Client with key '${clientKey}' does not exist.`);
		}

		return client.images.generate(params);
	}
}
