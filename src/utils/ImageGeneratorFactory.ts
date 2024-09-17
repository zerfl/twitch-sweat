import { OpenAIImageGenerator } from './OpenAIImageGenerator';
import { FalAIImageGenerator } from './FalAIImageGenerator';
import { ImageGenerator } from '../interfaces/ImageGenerator';
import { RunwareAIImageGenerator } from './RunwareAIImageGenerator';

export enum ImageGeneratorType {
	OpenAI = 'openai',
	FalAI = 'falai',
	RunwareAI = 'runwareai',
}

export class ImageGeneratorFactory {
	static createGenerator(type: ImageGeneratorType): ImageGenerator {
		switch (type) {
			case ImageGeneratorType.OpenAI:
				if (!process.env.OPENAI_API_KEY) {
					throw new Error('OPENAI_API_KEY is not set in the environment');
				}
				return new OpenAIImageGenerator(process.env.OPENAI_API_KEY);
			case ImageGeneratorType.FalAI:
				if (!process.env.FAL_KEY) {
					throw new Error('FAL_KEY is not set in the environment');
				}
				return new FalAIImageGenerator();
			case ImageGeneratorType.RunwareAI:
				if (!process.env.RUNWAREAI_API_KEY) {
					throw new Error('RUNWAREAI_API_KEY is not set in the environment');
				}
				return new RunwareAIImageGenerator(process.env.RUNWAREAI_API_KEY);
			default:
				throw new Error(`Unsupported image generator type: ${type}`);
		}
	}
}
