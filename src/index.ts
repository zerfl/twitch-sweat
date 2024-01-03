import 'dotenv/config';
import * as path from 'path';
import { PathLike, promises as fs } from 'fs';
import OpenAI, { BadRequestError } from 'openai';
import imgur from 'imgur';
import { fileURLToPath } from 'url';
import { AccessToken, InvalidTokenError, RefreshingAuthProvider } from '@twurple/auth';
import { Bot, createBotCommand } from '@twurple/easy-bot';
import { ApiClient } from '@twurple/api';

const requiredEnvVars = [
	'OPENAI_API_KEY',
	'IMGUR_CLIENT_ID',
	'TWITCH_CLIENT_ID',
	'TWITCH_CLIENT_SECRET',
	'TWITCH_CHANNELS',
	'TWITCH_ACCESS_TOKEN',
	'TWITCH_REFRESH_TOKEN',
];
requiredEnvVars.forEach((envVar) => {
	if (!process.env[envVar]) {
		throw new Error(`${envVar} is not set`);
	}
});

const originalLog = console.log;
console.log = (...args: unknown[]) => {
	originalLog(`[${new Date().toISOString()}]`, ...args);
};

type SavedCheerMap = {
	cheers: {
		broadcaster: string;
		users: { user: string; cheers: number }[];
	}[];
};
type SingleImage = {
	user: string;
	image: string;
	date: string;
};

type BroadcasterImages = {
	[key: string]: SingleImage[];
};

type UserMap = Map<string, number>;
type UserCheerMap = Map<string, UserMap>;

const OpenAi = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

// @ts-expect-error imgur types are outdated
const Imgur = new imgur.ImgurClient({
	clientId: process.env.IMGUR_CLIENT_ID,
});

const twitchChannels = process.env.TWITCH_CHANNELS!.split(',');
const userCheerMap: UserCheerMap = new Map();

async function storeImageData(broadcaster: string, user: string, image: string) {
	let broadcasterImageData: BroadcasterImages;

	try {
		broadcasterImageData = JSON.parse(await fs.readFile(imagesFilePath, 'utf-8'));
	} catch (error) {
		console.error(`Error reading image file at ${imagesFilePath}`, error);
		broadcasterImageData = {};
	}

	const imageData = broadcasterImageData[broadcaster] || [];
	imageData.push({
		user,
		image,
		date: new Date().toISOString(),
	});

	broadcasterImageData[broadcaster] = imageData;

	await fs.writeFile(imagesFilePath, JSON.stringify(broadcasterImageData, null, 4), 'utf-8');
}

async function getChatCompletion(messages: OpenAI.ChatCompletionMessageParam[]) {
	const completion = await OpenAi.chat.completions.create({
		messages: messages,
		model: 'gpt-3.5-turbo-1106',
		temperature: 0.7,
		max_tokens: 256,
	});
	if (!completion.choices[0].message.content) {
		throw new Error('No content received from OpenAI');
	}

	return completion.choices[0].message.content;
}

async function generateImage(username: string) {
	const result = { success: false, message: '' };

	try {
		console.log(`Analysing text: ${username}`);
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
		const analysisResult = await getChatCompletion(analysisMessages);
		if (!analysisResult) {
			result.message = 'Failed to receive an analysis result.';
			return result;
		}

		console.log(`Analysed text: ${analysisResult}`);

		const generatePromptMessages: OpenAI.ChatCompletionMessageParam[] = [
			...analysisMessages,
			{
				role: 'assistant',
				content: analysisResult,
			},
			{
				role: 'user',
				content: `Craft one simple and short sentence that describes a situation that's influenced by your analysis. Prefer the correct spelling if any typos were encountered. Focus on creating a scenario where a character's actions or situation reflect the essence or meaning of the provided description. The mood of the situation is whimsical, hyperbolic and funny. You will refer to the character as sweatling. For context, the sweatling always has smooth skin, but you must not mention that. You'll write a second sentence visually describing the background of the situation. Return the two sentences as a single paragraph.`,
			},
		];
		const sentenceResult = await getChatCompletion(generatePromptMessages);
		if (!sentenceResult) {
			result.message = 'Failed to receive a sentence result.';
			return result;
		}
		console.log(`Generated sentence: ${sentenceResult}`);

		const imagePrompt = `I NEED to test how the tool works with extremely simple prompts. DO NOT add any detail, just use it AS-IS: A vibrant blue sweatling, with smooth skin and a completely round head, wearing an orange hoodie and holding a heart in one hand. Nearby is a sign that reads '${username}' in big bold letters. ${sentenceResult} The style of the image features watercolor strokes and clear lines, complemented by pixel art.`;
		console.log(`Creating image: ${imagePrompt}`);
		const image = await OpenAi.images.generate({
			model: 'dall-e-3',
			prompt: imagePrompt,
			quality: 'standard',
			size: '1024x1024',
			response_format: 'url',
		});

		if (!image.data[0]?.url) {
			console.error('No image URL received from OpenAI');
			result.message =
				'Failed to receive an image URL from the image generation service.';
			return result;
		}

		console.log('Uploading image');
		const url = image.data[0].url;
		const uploadedImage = await Imgur.upload({
			type: 'url',
			image: url,
			title: username,
		});

		if (!uploadedImage.success) {
			console.error('Imgur upload unsuccessful', uploadedImage);
			result.message =
				'Image upload failed due to an issue with the image hosting service.';
			return result;
		}

		if (!uploadedImage.data.link) {
			console.error('No link received from Imgur after upload');
			result.message = 'Failed to retrieve the image link after upload.';
			return result;
		}

		console.log(
			`Image uploaded: ${uploadedImage.data.link}`,
		);

		result.success = true;
		result.message = uploadedImage.data.link;

		return result;
	} catch (error) {
		result.message = 'There was an error, sorry!';

		if (error instanceof BadRequestError && 'message' in error) {
			result.message = 'Your prompt was rejected.';
		}

		return result;
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

async function exists(f: PathLike) {
	try {
		await fs.stat(f);
		return true;
	} catch {
		return false;
	}
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function delay(milliseconds = 1000) {
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function isBroadcasterOnline(api: ApiClient, broadcasterName: string): Promise<boolean> {
	const user = await api.streams.getStreamsByUserNames([broadcasterName]);
	return user.some((u) => u !== null && u.userName === broadcasterName);
}

async function handleEventAndSendImageMessage(bot: Bot, broadcasterName: string, userName: string, gifting: boolean = false): Promise<void> {
	if (!await isBroadcasterOnline(bot.api, broadcasterName)) {
		console.log(`Broadcaster ${broadcasterName} is not online, not sending dnkMM message.`);
		return;
	}

	const imageResult = await generateImage(userName);
	if (!imageResult.success) {
		await bot.say(broadcasterName,
			`Thank you @${userName} for gifting dnkLove Unfortunately, I was unable to generate an image for you.`,
		);
		return;
	}

	await storeImageData(broadcasterName, userName, imageResult.message);

	if (gifting) {
		console.log(`Sending Gift Sub image`);
		await bot.say(broadcasterName,
			`Thank you @${userName} for gifting dnkLove This is for you: ${imageResult.message}`,
		);
		return;
	}

	console.log(`Sending Sub image`);
	await bot.say(broadcasterName,
		`Thank you @${userName} for subscribing dnkLove This is for you: ${imageResult.message}`,
	);
}

async function setUserCheer(
	broadcasterName: string,
	user: string,
	cheers: number,
) {
	const userLastRequestMap = userCheerMap.get(broadcasterName) || new Map();
	const previousCheerCount = userLastRequestMap.get(user) || 0;
	const newCheerCount = previousCheerCount + cheers;

	userLastRequestMap.set(user, newCheerCount);
	userCheerMap.set(broadcasterName, userLastRequestMap);
}

async function saveCheers(filePath: PathLike) {
	const cheers: SavedCheerMap = {
		cheers: Array.from(userCheerMap).map(([broadcasterName, userMap]) => ({
			broadcaster: broadcasterName,
			users: Array.from(userMap).map(([userName, cheers]) => ({
				user: userName,
				cheers: cheers,
			})),
		})),
	};

	await fs.writeFile(filePath, JSON.stringify(cheers, null, 4), 'utf-8');
}

async function loadCheers(filePath: PathLike) {
	try {
		const data = await fs.readFile(filePath, 'utf-8');
		const cheerData = JSON.parse(data) as SavedCheerMap;
		cheerData.cheers.forEach(({ broadcaster, users }) => {
			const userMap: UserMap = new Map();
			users.forEach(({ user, cheers }) => userMap.set(user, cheers));
			userCheerMap.set(broadcaster, userMap);
		});

	} catch (error) {
		console.error(`Error reading cheers count file at ${filePath}`, error);
	}
}

const truncate = (str: string, n: number) => (str.length > n ? `${str.substring(0, n - 1)}...` : str);

async function main() {
	try {
		let tokenData: AccessToken = {
			accessToken: process.env.TWITCH_ACCESS_TOKEN!,
			refreshToken: process.env.TWITCH_REFRESH_TOKEN!,
			expiresIn: 0,
			obtainmentTimestamp: 0,
			scope: ['chat:edit', 'chat:read'],
		};

		if (await exists(tokenFilePath)) {
			try {
				tokenData = JSON.parse(await fs.readFile(tokenFilePath, 'utf-8'));
			} catch (error) {
				console.error('Error reading token file, using default values.', error);
			}
		}

		const authProvider = new RefreshingAuthProvider({
			clientId: process.env.TWITCH_CLIENT_ID!,
			clientSecret: process.env.TWITCH_CLIENT_SECRET!,
		});

		authProvider.onRefresh(async (_userId, newTokenData) => {
			await fs.writeFile(
				tokenFilePath,
				JSON.stringify(newTokenData, null, 4),
				'utf-8',
			);
			tokenData = newTokenData;
		});
		await authProvider.addUserForToken(tokenData, ['chat']);

		const bot = new Bot({
			authProvider,
			channels: twitchChannels,
			commands: [createBotCommand('aisweatling', async (params, { userName, broadcasterName, say }) => {
				if (!['partyhorst', 'DunkOrSlam'].includes(userName)) {
					return;
				}

				if (params.length === 0) {
					return;
				}

				const { success, message } = await generateImage(params.join(' '));
				if (!success) {
					await say(truncate(`Sorry, ${userName}, I was unable to generate an image for you: ${message}`, 500));
					return;
				}

				await storeImageData(broadcasterName, userName, message);

				await say(`@${userName} ${message}`);
			})],
		});

		bot.onConnect(() => {
			console.log(`Connected to ${twitchChannels.join(', ')}!`);
		});


		bot.chat.onMessage(async (channel, user, _text, message) => {
			if (message.isCheer) {
				console.log(`Cheer received on ${channel} from ${user}! Bits: ${message.bits}`);
				await setUserCheer(channel, user, message.bits);
				await saveCheers(cheersCountFile);
			}
		});

		bot.onSub(({ broadcasterName, userName }) => {
			handleEventAndSendImageMessage(bot, broadcasterName, userName);
		});
		bot.onResub(({ broadcasterName, userName }) => {
			handleEventAndSendImageMessage(bot, broadcasterName, userName);
		});
		bot.onGiftPaidUpgrade(({ broadcasterName, userName }) => {
			handleEventAndSendImageMessage(bot, broadcasterName, userName);
		});
		bot.onPrimePaidUpgrade(({ broadcasterName, userName }) => {
			handleEventAndSendImageMessage(bot, broadcasterName, userName);
		});
		bot.onStandardPayForward(({ broadcasterName, gifterName }) => {
			handleEventAndSendImageMessage(bot, broadcasterName, gifterName, true);
		});
		bot.onCommunityPayForward(({ broadcasterName, gifterName }) => {
			handleEventAndSendImageMessage(bot, broadcasterName, gifterName, true);
		});

		bot.onCommunitySub(async ({ broadcasterName, gifterName, count }) => {
			console.log(`New community sub(s) on ${broadcasterName} by ${gifterName}! Count: ${count}`);
			await handleEventAndSendImageMessage(bot, broadcasterName, gifterName || 'anonymous', true);
		});

		bot.onSubGift(async ({ broadcasterName, userName }) => {
			await handleEventAndSendImageMessage(bot, broadcasterName, userName);
		});
	} catch (error: unknown) {
		if (error instanceof InvalidTokenError) {
			console.error('Invalid tokens, please check your environment variables');
			return;
		} else if (error instanceof Error) {
			console.trace(error);
		} else {
			console.error(error);
		}
	}
}

let appRootDir: string = '';
let tokenFilePath: string = '';
let cheersCountFile: string = '';
let imagesFilePath: string = '';


try {
	appRootDir = await getAppRootDir();
	tokenFilePath = path.join(appRootDir, 'data', 'tokens.json');
	cheersCountFile = path.join(appRootDir, 'data', 'cheers.json');
	imagesFilePath = path.join(appRootDir, 'data', 'images.json');
	await loadCheers(cheersCountFile);

	console.log(`Using token file: ${tokenFilePath}`);
	console.log(`Using cheers count file: ${cheersCountFile}`);
	console.log(`Using images file: ${imagesFilePath}`);

	await main();
} catch (error: unknown) {
	if (error instanceof Error) {
		console.error(error.message);
	}
	process.exit(1);
}
