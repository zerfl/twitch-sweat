import 'dotenv/config';
// import OpenAI, { BadRequestError } from 'openai';
// import imgur from 'imgur';
import { PathLike, promises as fs } from 'fs';
import { AccessToken, InvalidTokenError, RefreshingAuthProvider } from '@twurple/auth';
import { Bot } from '@twurple/easy-bot';
import * as path from 'path';
// import { CooldownManager } from './utils/CooldownManager';

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

const twitchChannels = process.env.TWITCH_CHANNELS!.split(',');
const giftCounts = new Map<string, Map<string | null, number>>();

// get the directory name of the current ES module

// tokenFilePath should be absolute path, relative to this script file
// const tokenFilePath = path.join(__dirname, 'tokens.json');

async function getAppRootDir()  {
	let tries = 0;
	let currentDir = path.dirname(new URL(import.meta.url).pathname);
	let found = await exists(path.join(currentDir, 'package.json'));

	while (!found && tries < 10) {
		currentDir = path.join(currentDir, '..');
		found = await exists(path.join(currentDir, 'package.json'));
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

async function main(tokenFile: string) {
	try {
		const tokenFilePath = tokenFile;
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

		bot.onSub(({broadcasterName, userName}) => {
			console.log(`New sub on ${broadcasterName} by ${userName}! This should be one :dnkMM`);
			// bot.say(broadcasterName, `:dnkMM`)
		});

		bot.onResub(({broadcasterName, userName}) => {
			console.log(`New resub on ${broadcasterName} by ${userName}! This should be one :dnkMM`);
			// bot.say(broadcasterName, `:dnkMM`)
		});

		bot.onCommunitySub(async ({ broadcasterName, gifterName, count }) => {
			const broadcasterGiftCounts =
				giftCounts.get(broadcasterName) || new Map();
			const previousGiftCount = broadcasterGiftCounts.get(gifterName) ?? 0;
			broadcasterGiftCounts.set(gifterName, previousGiftCount + count);
			giftCounts.set(broadcasterName, broadcasterGiftCounts);

			console.log(`New community sub(s) on ${broadcasterName} by ${gifterName}! This should be ${count} :dnkMM`);
		});

		bot.onSubGift(async ({ broadcasterName, gifterName }) => {
			const broadcasterGiftCounts =
				giftCounts.get(broadcasterName) || new Map();
			const previousGiftCount = broadcasterGiftCounts.get(gifterName) ?? 0;

			if (previousGiftCount > 0) {
				broadcasterGiftCounts.set(gifterName, previousGiftCount - 1);
			} else {
				console.log(`New sub gift on ${broadcasterName}! We should ignore this I believe.`)
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


try {
	const appRootDir = await getAppRootDir();
	const tokenFilePath = path.join(appRootDir, 'tokens.json');
	console.log(`Using token file: ${tokenFilePath}`);
		await main(tokenFilePath);
} catch (error: unknown) {
	if (error instanceof Error) {
		console.error(error.message);
	}
	process.exit(1);
}

