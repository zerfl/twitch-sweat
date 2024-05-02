import OpenAI from 'openai';

export class OpenAIManager {
	private readonly client: OpenAI;

	constructor(apiKey: string) {
		if (!apiKey) {
			throw new Error('OpenAI API key is required.');
		}
		this.client = new OpenAI({ apiKey });
	}

	async getChatCompletion(
		messages: OpenAI.ChatCompletionMessageParam[],
		length: number = 400,
		stop: string[] = [],
	): Promise<string> {
		const completion = await this.client.chat.completions.create({
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

	async generateImage(params: OpenAI.Images.ImageGenerateParams): Promise<OpenAI.Images.ImagesResponse> {
		return this.client.images.generate(params);
	}
}
