/**
 * Mock OpenAI API for testing
 *
 * Simulates OpenAI API responses without making actual API calls.
 */

import { MockOpenAIAnalysis, MockImageData } from './TestData';
import type OpenAI from 'openai';

export class MockOpenAIClient {
	public beta = {
		chat: {
			completions: {
				parse: async (params: any): Promise<any> => {
					// Simulate structured output response
					return {
						id: 'chatcmpl-mock',
						object: 'chat.completion',
						created: Date.now(),
						model: params.model || 'gpt-4',
						choices: [{
							index: 0,
							message: {
								role: 'assistant',
								content: null,
								parsed: MockOpenAIAnalysis
							},
							finish_reason: 'stop'
						}],
						usage: {
							prompt_tokens: 100,
							completion_tokens: 150,
							total_tokens: 250
						}
					};
				}
			}
		}
	};

	public images = {
		generate: async (params: OpenAI.Images.ImageGenerateParams): Promise<OpenAI.Images.ImagesResponse> => {
			// Simulate DALL-E image generation
			return {
				created: Date.now(),
				data: [{
					url: MockImageData.url,
					revised_prompt: MockImageData.revisedPrompt
				}]
			};
		}
	};
}

/**
 * Factory function to create mock OpenAI client
 */
export function createMockOpenAIClient(): any {
	return new MockOpenAIClient();
}

/**
 * Mock OpenAI that fails (for error testing)
 */
export class FailingMockOpenAIClient extends MockOpenAIClient {
	public override beta = {
		chat: {
			completions: {
				parse: async (): Promise<any> => {
					throw new Error('OpenAI API error: Rate limit exceeded');
				}
			}
		}
	};

	public override images = {
		generate: async (): Promise<any> => {
			throw new Error('DALL-E API error: Content policy violation');
		}
	};
}

/**
 * Mock OpenAI with configurable responses
 */
export class ConfigurableMockOpenAI extends MockOpenAIClient {
	private analysisResponse: any = MockOpenAIAnalysis;
	private imageResponse: any = { url: MockImageData.url, revised_prompt: MockImageData.revisedPrompt };
	private shouldFail = false;

	setAnalysisResponse(response: any) {
		this.analysisResponse = response;
	}

	setImageResponse(response: any) {
		this.imageResponse = response;
	}

	setShouldFail(fail: boolean) {
		this.shouldFail = fail;
	}

	public override beta = {
		chat: {
			completions: {
				parse: async (params: any): Promise<any> => {
					if (this.shouldFail) {
						throw new Error('Mock OpenAI failure');
					}

					return {
						id: 'chatcmpl-mock',
						object: 'chat.completion',
						created: Date.now(),
						model: params.model || 'gpt-4',
						choices: [{
							index: 0,
							message: {
								role: 'assistant',
								content: null,
								parsed: this.analysisResponse
							},
							finish_reason: 'stop'
						}]
					};
				}
			}
		}
	};

	public override images = {
		generate: async (): Promise<any> => {
			if (this.shouldFail) {
				throw new Error('Mock DALL-E failure');
			}

			return {
				created: Date.now(),
				data: [this.imageResponse]
			};
		}
	};
}
