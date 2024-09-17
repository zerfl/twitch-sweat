import * as fal from '@fal-ai/serverless-client';
import { ImageGenerationOptions, ImageGenerationResult, ImageGenerator } from '../interfaces/ImageGenerator';

export class FalAIImageGenerator implements ImageGenerator {
	async generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResult> {
		try {
			const result = await fal.subscribe('fal-ai/flux/dev', {
				mode: 'streaming',
				input: {
					prompt: options.prompt,
					image_size: this.convertSize(options.size),
					num_inference_steps: 28,
					guidance_scale: 3,
					num_images: options.numberOfImages || 1,
					enable_safety_checker: options.enableSafetyChecker ?? false,
				},
				logs: false,
			});

			if (!result.images || result.images.length === 0) {
				throw new Error('No image generated by Fal AI');
			}

			const image = result.images[0];
			return {
				success: true,
				message: image.url,
				content_type: image.content_type,
			};
		} catch (error) {
			console.error('Error generating image with Fal AI:', error);
			return {
				success: false,
				message: error instanceof Error ? error.message : 'Unknown error occurred',
			};
		}
	}

	private convertSize(size?: string): string {
		switch (size) {
			case '1024x1024':
				return 'square_hd';
			case '512x512':
				return 'square';
			default:
				return 'landscape_4_3';
		}
	}
}