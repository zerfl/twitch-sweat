import { RunwareServer } from '@runware/sdk-js';
import { ImageGenerationOptions, ImageGenerationResult, ImageGenerator } from '../interfaces/ImageGenerator';

export class RunwareAIImageGenerator implements ImageGenerator {
	private readonly server: RunwareServer;

	constructor(apiKey: string) {
		this.server = new RunwareServer({ apiKey });
	}

	async generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
		try {
			const [width, height] = options.size.split('x');

			console.log('Generating image with RunwareAI:', options.prompt);

			const image = await this.server.requestImages({
				positivePrompt: options.prompt,
				width: parseInt(width, 10),
				height: parseInt(height, 10),
				model: 'civitai:618692@691639',
				outputType: 'URL',
				outputFormat: 'PNG',
				checkNsfw: false,
				steps: 28,
				CFGScale: 3.5,
				numberResults: 1,
			});

			if (!image || !image[0].imageURL) {
				throw new Error('No image URL received from RunwareAI');
			}

			return {
				success: true,
				message: image[0].imageURL,
				revisedPrompt: image[0].positivePrompt,
			};
		} catch (error) {
			console.error('Error generating image with RunwareAI:', error);
			return {
				success: false,
				message: error instanceof Error ? error.message : 'Unknown error occurred',
			};
		}
	}
}
