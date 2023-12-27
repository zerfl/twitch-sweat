import 'dotenv/config';
import * as path from 'path';
import { PathLike, promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import { AccessToken, InvalidTokenError, RefreshingAuthProvider } from '@twurple/auth';
import { Bot } from '@twurple/easy-bot';
import { ApiClient } from '@twurple/api';

const requiredEnvVars = [
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

const twitchChannels = process.env.TWITCH_CHANNELS!.split(',');
const giftCounts = new Map<string, Map<string | null, number>>();
let broadcasterCounts: BroadcasterMessageCount;


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

		bot.onSub(({ broadcasterName }) => handleEventAndSendMessage(bot, api, broadcasterName));
		bot.onResub(({ broadcasterName }) => handleEventAndSendMessage(bot, api, broadcasterName));

		bot.onCommunitySub(async ({ broadcasterName, gifterName, count }) => {
			const broadcasterGiftCounts =
				giftCounts.get(broadcasterName) || new Map();
			const previousGiftCount = broadcasterGiftCounts.get(gifterName) ?? 0;
			broadcasterGiftCounts.set(gifterName, previousGiftCount + count);
			giftCounts.set(broadcasterName, broadcasterGiftCounts);

			console.log(`New community sub(s) on ${broadcasterName} by ${gifterName}! Count: ${count}, This should be ignored ???`);
		});

		bot.onSubGift(async ({ broadcasterName, gifterName }) => {
			const broadcasterGiftCounts =
				giftCounts.get(broadcasterName) || new Map();
			const previousGiftCount = broadcasterGiftCounts.get(gifterName) ?? 0;

			if (previousGiftCount > 0) {
				broadcasterGiftCounts.set(gifterName, previousGiftCount - 1);
			} else {
				console.log(`New sub gift on ${broadcasterName}! We should NOT ignore this I believe. ???`);
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
