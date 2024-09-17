import OpenAI from 'openai';
import { ImageGenerationOptions, ImageGenerationResult, ImageGenerator } from '../interfaces/ImageGenerator';

export class OpenAIImageGenerator implements ImageGenerator {
	private readonly client: OpenAI;

	constructor(apiKey: string) {
		this.client = new OpenAI({ apiKey });
	}

	async generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
		try {
			const hardenPrompt = `DO NOT add or remove any detail, just use it AS-IS, YOU MUST NOT ALTER THIS TEXT: ${options.prompt}`;
			console.log('Generating image with OpenAI:', hardenPrompt);

			const completion = await this.client.images.generate({
				model: 'dall-e-3',
				prompt: hardenPrompt,
				n: options.numberOfImages || 1,
				size: (options.size as OpenAI.Images.ImageGenerateParams['size']) || '1024x1024',
				response_format: 'url',
			});

			if (!completion.data[0]?.url) {
				throw new Error('No image URL received from OpenAI');
			}

			console.log('Revised prompt:', completion.data[0].revised_prompt);

			return {
				success: true,
				message: completion.data[0].url,
				revisedPrompt: completion.data[0].revised_prompt,
			};
		} catch (error) {
			console.log('Error generating image with OpenAI');
			return {
				success: false,
				message: error instanceof Error ? error.message : 'Unknown error occurred',
			};
		}
	}
}
