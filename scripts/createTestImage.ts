import 'dotenv/config';
import OpenAI from 'openai';
import imgur, { ImgurClient } from 'imgur';

const requiredEnvVars = ['OPENAI_API_KEY', 'IMGUR_CLIENT_ID', 'IMGUR_REFRESH_TOKEN', 'IMGUR_CLIENT_SECRET'];
requiredEnvVars.forEach((envVar) => {
	if (!process.env[envVar]) throw new Error(`${envVar} is not set`);
});

class ChatCompletionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ChatCompletionError';
	}
}

class ImageGenerationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ImageGenerationError';
	}
}

class ImageUploadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ImageUploadError';
	}
}

async function getChatCompletion(OpenAi: OpenAI, messages: OpenAI.ChatCompletionMessageParam[]) {
	try {
		const completion = await OpenAi.chat.completions.create({
			model: 'gpt-3.5-turbo-1106',
			messages: messages,
			temperature: 0.7,
			max_tokens: 256,
		});

		return completion.choices[0].message.content;
	} catch (error: unknown) {
		if (error instanceof Error) throw new ChatCompletionError(error.message);
	}
}

async function getImageGeneration(OpenAi: OpenAI, prompt: string) {
	try {
		const imageCompletion = await OpenAi.images.generate({
			model: 'dall-e-3',
			prompt: prompt,
			quality: 'standard',
			size: '1024x1024',
			response_format: 'url',
		});

		return imageCompletion.data[0].url;
	} catch (error: unknown) {
		if (error instanceof Error) throw new ImageGenerationError(error.message);
	}
}

async function getImageUpload(Imgur: ImgurClient, imageUrl: string, username: string) {
	try {
		return await Imgur.upload({ type: 'url', image: imageUrl, title: username });
	} catch (error: unknown) {
		if (error instanceof Error) throw new ImageUploadError(error.message);
	}
}

// Image generator function
async function generateAndUploadImage(username: string, OpenAi: OpenAI, Imgur: ImgurClient) {
	const analysisPrompt = `You are a diligent language analyst tasked with dissecting words to uncover their meanings. Your analysis should start by examining the word for recognizable roots. Consider if it's a compound word formed by smaller words or a misspelling of a common word. If the word is not in English, explore common foreign languages. For unidentifiable words, offer a creative interpretation based on phonetics or semblance to known words. Persist in your analysis from different perspectives until a plausible meaning or structure is identified. For nicknames or fictional terms, interpret based on construction or identifiable parts. Your goal is to always provide a useful interpretation or insight into the word's possible meaning and structure. Return a single, concise sentence that encapsulates the potential meaning or structure of the word.`;
	const analysisMessages: OpenAI.ChatCompletionMessageParam[] = [
		{
			role: 'system',
			content: analysisPrompt,
		},
		{
			role: 'user',
			content: username,
		},
	];

	const analysisResult = await getChatCompletion(OpenAi, analysisMessages);
	console.debug(analysisResult);

	const generatePromptMessages: OpenAI.ChatCompletionMessageParam[] = [
		...analysisMessages,
		{
			role: 'assistant',
			content: analysisResult,
		},
		{
			role: 'user',
			content: `Craft one simple sentence that describes a situation that's influenced by the meaning you just gave. Focus on creating a scenario where a character's actions or situation reflect the essence or meaning of the provided description. The mood of the situation is whimsical, hyperbolic and wholesome. You will refer to the character as sweatling. You'll write a second sentence visually describing the background of the situation. Return the two sentences as a single paragraph.`,
		},
	];

	const sentenceResult = await getChatCompletion(OpenAi, generatePromptMessages);
	if (!sentenceResult) throw new Error('No situation generated');
	console.debug(sentenceResult);

	const imagePrompt = `I NEED to test how the tool works with extremely simple prompts. DO NOT add any detail, just use it AS-IS: A vibrant blue sweatling, with smooth skin and a completely round head, wearing an orange hoodie and holding a heart in one hand. ${sentenceResult} There is a sign with the word '${username}' in big bold letters. The style of the image combines watercolor strokes with clear outlines.`;
	const imageData = await getImageGeneration(OpenAi, imagePrompt);
	if (!imageData) throw new Error('No image generated');
	console.debug(imageData);

	const uploadedImage = await getImageUpload(Imgur, imageData, username);
	if (!uploadedImage || !uploadedImage.data.link) throw new Error('Image upload failed');
	console.debug(uploadedImage.data.link);

	return uploadedImage.data.link;
}

async function main() {
	const OpenAi = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
	// @ts-expect-error ImgurClient is not typed properly
	const Imgur = new imgur.ImgurClient({
		clientId: process.env.IMGUR_CLIENT_ID,
		// clientSecret: process.env.IMGUR_CLIENT_SECRET,
		// refreshToken: process.env.IMGUR_REFRESH_TOKEN,
	});

	const username = process.argv[2];
	if (!username) return;
	try {
		const image = await generateAndUploadImage(username, OpenAi, Imgur);
		console.log(image);
	} catch (error: unknown) {
		if (error instanceof Error) console.error(error.message);
	}
}

await main();
