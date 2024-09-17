export interface ImageGenerationOptions {
	prompt: string;
	size: string;
	style?: string | null;
	numberOfImages?: number;
	enableSafetyChecker?: boolean;
}

export interface ImageGenerationResult {
	success: boolean;
	message: string;
	analysis?: string;
	revisedPrompt?: string;
	content_type?: string;
}

export interface ImageGenerator {
	generateImage(options: ImageGenerationOptions): Promise<ImageGenerationResult>;
}
