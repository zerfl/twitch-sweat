import OpenAI from 'openai';

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
		length: number = 400,
		stop: string[] = [],
	): Promise<string> {
		const completion = await this.client.chat.completions.create({
			messages: messages,
			model: this.model,
			temperature: 1,
			max_tokens: length,
			stop: stop.length ? stop : null,
		});

		if (!completion.choices[0]?.message?.content) {
			throw new Error('No content received from OpenAI');
		}

		return completion.choices[0].message.content;
	}

	async generateImage(params: OpenAI.Images.ImageGenerateParams): Promise<OpenAI.Images.ImagesResponse> {
		return this.client.images.generate(params);
	}
}
