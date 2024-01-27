import 'dotenv/config';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';
import { PathLike, promises as fs } from 'fs';
import { CloudflareUploader } from '../src/utils/CloudflareUploader';

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

async function getChatCompletion(OpenAi: OpenAI, messages: OpenAI.ChatCompletionMessageParam[]) {
	try {
		const completion = await OpenAi.chat.completions.create({
			model: 'gpt-3.5-turbo-1106',
			messages: messages,
			temperature: 1,
			max_tokens: 256,
		});

		return completion.choices[0]?.message.content;
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

		return imageCompletion.data[0]?.url;
	} catch (error: unknown) {
		if (error instanceof Error) throw new ImageGenerationError(error.message);
	}
}

function getUserMeaning(user: string) {
	return userMeaningMap.get(user) || user;
}

// Image generator function
async function generateAndUploadImage(username: string, OpenAi: OpenAI) {
	const perhapsUsernameWithMeaning = getUserMeaning(username.toLowerCase());

	const analysisPrompt = `Analyze the given username by dissecting it into distinct elements. Investigate each segment for linguistic roots across various languages, including English and others, as well as common abbreviations, cultural references, and numerical significance globally. Provide an literal and insightful interpretation that explores the potential meanings, origins, and structure of the username, drawing from a diverse linguistic and cultural spectrum. Aim to deliver a concise and comprehensive sentence that encapsulates these multifaceted aspects, offering a deep and broad understanding of the username's possible significance and composition. Try to determine a gender based on the username and analysis.

Based on your best interpretation of the username, create a character card that a viewer would recognize as representing the username, using the following template:
\`\`\`
Username:
Possible gender:
Characteristics:
Location:
Literal meaning:
Outfit:
Interests:
Facial expression:
\`\`\``;
	const analysisMessages: OpenAI.ChatCompletionMessageParam[] = [
		{
			role: 'system',
			content: analysisPrompt,
		},
		{
			role: 'user',
			content: 'partyhorst',
		},
		{
			role: 'assistant',
			content: `This username "partyhorst" seems to be a combination of "party" and the name "Horst" which is of German origin and means "man of the forest," often associated with strength and masculinity. The word "party" typically refers to a festive gathering or event. The juxtaposition of "party" and "Horst" creates an interesting contrast between lively celebration and a strong, grounded presence, perhaps indicative of a dynamic and spirited individual with a solid foundation. The use of "horst" could also be a nod to its geological meaning, referring to a raised area of land, which could symbolize elevation or standing out.

\`\`\`
Username: partyhorst
Possible gender: male
Characteristics: fun-loving, outgoing, energetic, socialising, confident, masculine
Location: at a party
Literal meaning: a person loving to party
Outfit: vibrant, bold, flashy, fun patterns
Interests: partying, lively dancing, throwing a party, high-fiving
Facial expression: happy, cheerful, laughing
\`\`\``,
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
			content: `Craft an exaggerated narrative that reflects the literal interpretation of the given username analysis, while concealing the username itself. In this narrative:

Include a heart-shaped object that symbolically resonates with the username's literal interpretation.
Refer to the main character as 'sweatling' and include their gender.
Focus on non-sexual aspects or indirect connections. 

Begin with a detailed yet concise description of the sweatling, whose actions and surroundings vividly embody the username's literal meaning.
Ensure the background scene is vibrant and thematically aligned with the literal interpretation of the username.
Conclude with a striking portrayal of the sweatling's facial expression.
Start the paragraph with 'The sweatling' and use simple English for clarity.`,
		},
	];

	console.log(generatePromptMessages);

	const sentenceResult = await getChatCompletion(OpenAi, generatePromptMessages);
	if (!sentenceResult) throw new Error('No situation generated');

	const sentenceResultSingleLine = sentenceResult.replace(/\n/g, '');

	console.log('Situation: ', sentenceResultSingleLine);

	const imagePrompt = `A vibrant blue sweatling, with a completely round head and smooth skin is wearing an orange hoodie (ALL OF IT IS EXTREMELY IMPORTANT!). Nearby is a sign with the bold letters '${username}' on it. The overall aesthetic for this vibrant scene is in watercolor style with soft hues blending seamlessly and clear outlines. ${sentenceResult}`;

	console.log('Image prompt: ', imagePrompt);

	const imageData = await getImageGeneration(OpenAi, imagePrompt);
	if (!imageData) throw new Error('No image generated');
	console.debug(imageData);

	const uploadedImage = await uploader.fromURL(imageData);
	if (!uploadedImage.success) throw new Error('Image upload failed');
	console.debug(uploadedImage);

	return uploadedImage.result.id;
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

	const username = process.argv[2];
	if (!username) return;
	try {
		appRootDir = await getAppRootDir();
		meaningsFilePath = path.join(appRootDir, 'data', 'meanings.json');

		await loadMeanings(meaningsFilePath);

		const image = await generateAndUploadImage(username, OpenAi);
		const finalUrl = `${process.env.CLOUDFLARE_IMAGES_URL}/${image}.png`;
		console.log(finalUrl);
	} catch (error: unknown) {
		if (error instanceof Error) console.error(error.message);
	}
}

let uploader: CloudflareUploader;
try {
	uploader = new CloudflareUploader(process.env.CLOUDFLARE_ACCOUNT_ID!, process.env.CLOUDFLARE_API_TOKEN!);
	await main();
} finally {
	process.exit(0);
}
