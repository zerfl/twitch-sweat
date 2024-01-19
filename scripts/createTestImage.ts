import 'dotenv/config';
import OpenAI from 'openai';
import imgur, { ImgurClient } from 'imgur';
import path from 'path';
import { fileURLToPath } from 'url';
import { PathLike, promises as fs } from 'fs';

const requiredEnvVars = ['OPENAI_API_KEY', 'IMGUR_CLIENT_ID', 'IMGUR_REFRESH_TOKEN', 'IMGUR_CLIENT_SECRET'];
requiredEnvVars.forEach((envVar) => {
	if (!process.env[envVar]) throw new Error(`${envVar} is not set`);
});

type UserMeaningMap = Map<string, string>;
const userMeaningMap: UserMeaningMap = new Map();

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

		console.log(imageCompletion.data[0]);

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

function getUserMeaning(user: string) {
	return userMeaningMap.get(user) || user;
}

// Image generator function
async function generateAndUploadImage(username: string, OpenAi: OpenAI, Imgur: ImgurClient) {
	const perhapsUsernameWithMeaning = getUserMeaning(username.toLowerCase());

	const analysisPrompt = `Analyze the provided text to automatically identify words in them. You'll be given a unique username. Always provide a useful interpretation or insight into the word's possible meaning and structure. Always return a single and concise sentence that encapsulates the potential meaning and structure of the username.`;
	const analysisMessages: OpenAI.ChatCompletionMessageParam[] = [
		{
			role: 'system',
			content: analysisPrompt,
		},
		{
			role: 'user',
			content: perhapsUsernameWithMeaning,
		},
	];

	const analysisResult = await getChatCompletion(OpenAi, analysisMessages);
	console.debug('Meaning: ', analysisResult);

	const generatePromptMessages: OpenAI.ChatCompletionMessageParam[] = [
		...analysisMessages,
		{
			role: 'assistant',
			content: analysisResult,
		},
		{
			role: 'user',
			content: `Create an epic and hyperbolic scenario that captures the essence of the username without directly mentioning it. Follow these steps to create the scenario:
- Avoid using names, hints, or references to specific real people or celebrities, while maintaining their gender and physique in your depiction.
- Refer to the main character in your scenario as 'sweatling.'. Avoid including the username directly in the scenario.
- Start with a detailed sentence about the sweatling, ensuring their actions and reactions embody the interpreted meaning of the username.
- Dress the sweatling in an outfit with orange as the primary color, reflecting the scenario's tone and the username's essence.
- Provide a vivid description of the scene's background, focusing on details that enhance the narrative.
- Include an expressive depiction of the sweatling's facial expression.
- Concentrate on describing a single, static snapshot of the scenario, akin to capturing a photograph, without depicting any progression or sequence of events.
- Include a heart-shaped item in the scenario, which is crucial to the narrative. Describe this item in detail, ensuring it is based on a direct and explicit interpretation of the username or its meaning, making it a pivotal symbol in the scenario.
- Choose the heart-shaped item based on a direct and explicit interpretation of the username or its meaning, making it a pivotal symbol in the scenario.
- Maintain a cohesive and consistent tone throughout the scenario.
- Steer clear of suggestive content, fetishes, or any form of sexualization, especially in usernames or topics with sexual connotations.
- Focus on non-sexual aspects or elements that indirectly relate to the username without emphasizing the sexualized part.

Complete the task by crafting one cohesive paragraph that seamlessly integrates all the above elements, adhering closely to the instructions provided and using simple English, starting with the phrase 'The sweatling'`,
		},
	];

	console.log(generatePromptMessages);

	const sentenceResult = await getChatCompletion(OpenAi, generatePromptMessages);
	if (!sentenceResult) throw new Error('No situation generated');

	const sentenceResultSingleLine = sentenceResult.replace(/\n/g, '');

	console.log('Situation: ', sentenceResultSingleLine);

	const imagePrompt = `I NEED to test how the tool works with extremely simple prompts. DO NOT add any detail, just use it AS-IS. "
A vibrant blue sweatling, with a completely round head and smooth skin is wearing an orange hoodie. A sign bearing the bold letters '${username}' is prominently featured in the vicinity. ${sentenceResult} The overall aesthetic for this vibrant scene combines elements of watercolor, pixel art, and anime styles with clear outlines.
" DO NOT ALTER THE PROMPT AT ALL.`;

	console.log('Image prompt: ', imagePrompt);

	const imageData = await getImageGeneration(OpenAi, imagePrompt);
	if (!imageData) throw new Error('No image generated');
	console.debug(imageData);

	const uploadedImage = await getImageUpload(Imgur, imageData, username);
	if (!uploadedImage || !uploadedImage.data.link) throw new Error('Image upload failed');
	console.debug(uploadedImage.data.link);

	return uploadedImage.data.link;
}

async function exists(f: PathLike) {
	try {
		await fs.stat(f);
		return true;
	} catch {
		return false;
	}
}

async function getAppRootDir() {
	let tries = 0;
	let currentDir = path.dirname(fileURLToPath(import.meta.url));
	let found = await exists(path.join(currentDir, 'package.json'));

	while (!found && tries < 10) {
		currentDir = path.join(currentDir, '..');
		found = await exists(path.join(currentDir, 'package.json'));
		console.log(path.join(currentDir, 'package.json'));
		tries++;
	}

	if (!found) {
		throw new Error('package.json not found after 10 attempts');
	}

	return currentDir;
}

async function loadMeanings(filePath: PathLike) {
	try {
		const data = await fs.readFile(filePath, 'utf-8');
		const meanings = JSON.parse(data) as Record<string, string>;
		Object.entries(meanings).forEach(([user, meaning]) => {
			userMeaningMap.set(user, meaning);
		});
	} catch (error) {
		console.error(`Error reading meanings file at ${filePath}`, error);
	}
}

let appRootDir: string = '';
let meaningsFilePath: string = '';

async function main() {
	const OpenAi = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
	// @ts-expect-error ImgurClient is not typed properly
	const Imgur = new imgur.ImgurClient({
		clientId: process.env.IMGUR_CLIENT_ID,
	});

	const username = process.argv[2];
	if (!username) return;
	try {
		appRootDir = await getAppRootDir();
		meaningsFilePath = path.join(appRootDir, 'data', 'meanings.json');

		await loadMeanings(meaningsFilePath);

		const image = await generateAndUploadImage(username, OpenAi, Imgur);
		console.log(image);
	} catch (error: unknown) {
		if (error instanceof Error) console.error(error.message);
	}
}

await main();
