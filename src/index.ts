import 'dotenv/config';
import * as path from 'path';
import { PathLike, promises as fs } from 'fs';
import OpenAI, { BadRequestError } from 'openai';
import imgur from 'imgur';
import { fileURLToPath } from 'url';
import { AccessToken, InvalidTokenError, RefreshingAuthProvider } from '@twurple/auth';
import { Bot } from '@twurple/easy-bot';
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

type BroadcasterMessageCount = Map<string, number>;

const OpenAi = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

// @ts-expect-error imgur types are outdated
const Imgur = new imgur.ImgurClient({
	clientId: process.env.IMGUR_CLIENT_ID,
});


const twitchChannels = process.env.TWITCH_CHANNELS!.split(',');
const giftCounts = new Map<string, Map<string | null, number>>();
let broadcasterCounts: BroadcasterMessageCount;


async function generateImage(message: string) {
	const result = { success: false, message: '' };

	try {
		console.log(`Creating image: ${message}`);
		const image = await OpenAi.images.generate({
			model: 'dall-e-3',
			prompt: message,
			quality: 'hd',
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
			`Sending response back. Image uploaded: ${uploadedImage.data.link}`,
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

async function readMessageCount(filePath: string): Promise<BroadcasterMessageCount> {
	try {
		const data = await fs.readFile(filePath, 'utf8');
		return new Map(Object.entries(JSON.parse(data)));
	} catch (error) {
		return new Map();
	}
}

async function writeMessageCount(filePath: string, counts: BroadcasterMessageCount): Promise<void> {
	const objectToSave = Object.fromEntries(counts);
	await fs.writeFile(filePath, JSON.stringify(objectToSave), 'utf8');
}


async function exists(f: PathLike) {
	try {
		await fs.stat(f);
		return true;
	} catch {
		return false;
	}
}

async function delay(milliseconds = 1000) {
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function isBroadcasterOnline(api: ApiClient, broadcasterName: string): Promise<boolean> {
	const user = await api.streams.getStreamsByUserNames([broadcasterName]);
	return user.some((u) => u !== null && u.userName === broadcasterName);
}

async function handleEventAndSendImageMessage(bot: Bot, api: ApiClient, broadcasterName: string, userName: string): Promise<void> {
	if (!await isBroadcasterOnline(api, broadcasterName)) {
		console.log(`Broadcaster ${broadcasterName} is not online, not sending dnkMM message.`);
		return;
	}

	const imageResult = await generateImage(
		`A character named 'Sweatling', depicted in vibrant blue, wearing an orange hoodie, and holding a heart in front of its body. Below the character is a sign displaying the word '${userName}'. The image combines pixel art and oil painting styles. The character should be designed in pixel art, reminiscent of classic video games with clear, blocky pixels. The rest of the image, including the background and the sign, should have the texture and brushwork characteristic of an oil painting, creating a unique fusion of digital and traditional art.`,
	);
	if (!imageResult.success) {
		return;
	}

	console.log(`Thank you @${userName} for subscribing 🎁 This is for you: ${imageResult.message}`);

	await bot.say(
		broadcasterName,
		`Thank you @${userName} for subscribing 🎁 This is for you: ${imageResult.message}`,
	);
}

async function handleEventAndSendMessage(bot: Bot, api: ApiClient, broadcasterName: string): Promise<void> {
	if (!await isBroadcasterOnline(api, broadcasterName)) {
		console.log(`Broadcaster ${broadcasterName} is not online, not sending dnkMM message.`);
		return;
	}

	const currentCount = broadcasterCounts.get(broadcasterName) ?? 0;
	broadcasterCounts.set(broadcasterName, currentCount + 1);

	await writeMessageCount(messageCountFile, broadcasterCounts);
	await bot.say(broadcasterName, `dnkMM`);
	console.log(`dnkMM message sent on ${broadcasterName}. Total count: ${currentCount + 1}`);
}

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

		authProvider.onRefresh(async (userId, newTokenData) => {
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
		});
		const api = new ApiClient({ authProvider });

		bot.onConnect(() => {
			console.log(`Connected to ${twitchChannels.join(', ')}!`);
		});

		bot.onSub(({ broadcasterName, userName }) => handleEventAndSendImageMessage(bot, api, broadcasterName, userName));
		bot.onResub(({ broadcasterName, userName }) => handleEventAndSendImageMessage(bot, api, broadcasterName, userName));

		bot.onCommunitySub(async ({ broadcasterName, gifterName, count }) => {
			const broadcasterGiftCounts =
				giftCounts.get(broadcasterName) || new Map();
			const previousGiftCount = broadcasterGiftCounts.get(gifterName) ?? 0;
			broadcasterGiftCounts.set(gifterName, previousGiftCount + count);
			giftCounts.set(broadcasterName, broadcasterGiftCounts);

			console.log(`New community sub(s) on ${broadcasterName} by ${gifterName}! Count: ${count}`);
			// await handleEventAndSendMessage(bot, api, broadcasterName);
		});

		bot.onSubGift(async ({ broadcasterName, gifterName, userName }) => {
			const broadcasterGiftCounts =
				giftCounts.get(broadcasterName) || new Map();
			const previousGiftCount = broadcasterGiftCounts.get(gifterName) ?? 0;

			console.log(`${broadcasterName} received a gift sub from ${gifterName} to ${userName}.`);

			if (previousGiftCount > 0) {
				broadcasterGiftCounts.set(gifterName, previousGiftCount - 1);
			} else {
				// await handleEventAndSendMessage(bot, api, broadcasterName);
				console.log(`Gift count is 0, sending image message`);
				await handleEventAndSendImageMessage(bot, api, broadcasterName, userName);
			}
			giftCounts.set(broadcasterName, broadcasterGiftCounts);
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
let messageCountFile: string = '';

try {
	appRootDir = await getAppRootDir();
	tokenFilePath = path.join(appRootDir, 'data', 'tokens.json');
	messageCountFile = path.join(appRootDir, 'data', 'messageCount.json');
	broadcasterCounts = await readMessageCount(messageCountFile);

	console.log(`Using token file: ${tokenFilePath}`);
	console.log(`Using message count file: ${messageCountFile}, current counts: ${JSON.stringify(Object.fromEntries(broadcasterCounts))}`);

	await main();
} catch (error: unknown) {
	if (error instanceof Error) {
		console.error(error.message);
	}
	process.exit(1);
}
