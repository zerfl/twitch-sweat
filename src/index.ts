import 'dotenv/config';
import * as path from 'path';
import { PathLike, promises as fs } from 'fs';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { AccessToken, InvalidTokenError, RefreshingAuthProvider } from '@twurple/auth';
import { Bot, createBotCommand } from '@twurple/easy-bot';
import { ActivityType, Client as DiscordClient, Events, GatewayIntentBits, Partials } from 'discord.js';
import throttledQueue from 'throttled-queue';
import { IgnoreListManager } from './utils/IgnoreListManager';
import { CloudflareUploader } from './utils/CloudflareUploader';

const requiredEnvVars = [
	'TWITCH_CLIENT_ID',
	'TWITCH_CLIENT_SECRET',
	'TWITCH_CHANNELS',
	'TWITCH_ACCESS_TOKEN',
	'TWITCH_REFRESH_TOKEN',
	'OPENAI_API_KEY',
	'OPENAI_IMAGES_PER_MINUTE',
	'OPENAI_ANALYZER_PROMPT',
	'OPENAI_SCENARIO_PROMPT',
	'DISCORD_BOT_TOKEN',
	'DISCORD_CHANNELS',
	'DISCORD_ADMIN_USER_ID',
	'MAX_RETRIES',
	'CLOUDFLARE_ACCOUNT_ID',
	'CLOUDFLARE_API_TOKEN',
	'CLOUDFLARE_IMAGES_URL',
];
requiredEnvVars.forEach((envVar) => {
	if (!process.env[envVar]) {
		throw new Error(`${envVar} is not set`);
	}
});

type SavedCheerMap = {
	cheers: {
		broadcaster: string;
		users: { user: string; cheers: number }[];
	}[];
};

type SingleImage = {
	image: string;
	analysis: string;
	revisedPrompt: string;
	date: string;
};

type ImageGenerationSuccess = {
	success: true;
	message: string;
	analysis: string;
	revisedPrompt: string;
};

type ImageGenerationError = {
	success: false;
	message: string;
};

type ImageGenerationResult = ImageGenerationSuccess | ImageGenerationError;

type BroadcasterImages = {
	[key: string]: { [key: string]: SingleImage[] };
};

type UserMap = Map<string, number>;
type UserCheerMap = Map<string, UserMap>;
type UserMeaningMap = Map<string, string>;

async function ensureFileExists(filePath: string, defaultContent: string = ''): Promise<void> {
	try {
		await fs.access(filePath);
	} catch {
		await fs.writeFile(filePath, defaultContent, 'utf-8');
	}
}

async function getImageData(broadcaster: string) {
	let broadcasterImageData: BroadcasterImages;

	try {
		broadcasterImageData = JSON.parse(await fs.readFile(imagesFilePath, 'utf-8'));
	} catch (error) {
		console.error(`Error reading image file at ${imagesFilePath}`, error);
		broadcasterImageData = {};
	}

	return broadcasterImageData[broadcaster] || [];
}

// TODO: This is seriously inefficient, we need to store the data in a database ASAP
async function storeImageData(broadcaster: string, user: string, imageData: SingleImage) {
	let broadcasterImageData: BroadcasterImages = {};

	try {
		broadcasterImageData = JSON.parse(await fs.readFile(imagesFilePath, 'utf-8'));
	} catch (error) {
		console.error(`Error reading image file at ${imagesFilePath}`, error);
	}

	const userImages = broadcasterImageData[broadcaster]?.[user] || [];
	userImages.push(imageData);

	broadcasterImageData[broadcaster] = { ...(broadcasterImageData[broadcaster] || {}), [user]: userImages };

	await fs.writeFile(imagesFilePath, JSON.stringify(broadcasterImageData, null, 4), 'utf-8');

	// Calculate total number of images for the broadcaster
	let totalImages = 0;
	for (const user in broadcasterImageData[broadcaster]) {
		totalImages += broadcasterImageData[broadcaster][user].length;
	}

	return totalImages;
}

async function getChatCompletion(messages: OpenAI.ChatCompletionMessageParam[], length: number) {
	const completion = await OpenAi.chat.completions.create({
		messages: messages,
		model: 'gpt-3.5-turbo-0613',
		temperature: 1,
		max_tokens: length,
	} as OpenAI.ChatCompletionCreateParamsNonStreaming);
	if (!completion.choices[0].message.content) {
		throw new Error('No content received from OpenAI');
	}

	return completion.choices[0].message.content;
}

async function generateImage(username: string, metadata: Record<string, unknown> = {}): Promise<ImageGenerationResult> {
	const perhapsUsernameWithMeaning = getUserMeaning(username.toLowerCase());
	const analysisMessages: OpenAI.ChatCompletionMessageParam[] = [
		{
			role: 'system',
			content: analyzerPrompt,
		},
		{
			role: 'user',
			content: perhapsUsernameWithMeaning,
		},
	];

	const analysisResult = await openaiThrottle(() => {
		console.log(perhapsUsernameWithMeaning, `Analysing text: ${username} / ${perhapsUsernameWithMeaning}`);
		return getChatCompletion(analysisMessages, 256);
	});

	console.log(perhapsUsernameWithMeaning, `Analysed text: ${analysisResult}`);
	const sentenceResult = await openaiThrottle(() => {
		const generatePromptMessages: OpenAI.ChatCompletionMessageParam[] = [
			...analysisMessages,
			{
				role: 'assistant',
				content: analysisResult,
			},
			{
				role: 'user',
				content: scenarioPrompt,
			},
		];
		return getChatCompletion(generatePromptMessages, 256);
	});

	console.log(perhapsUsernameWithMeaning, `Generated sentence: ${sentenceResult}`);

	const imagePrompt = `I NEED to test how the tool works with extremely simple prompts. DO NOT add any detail, just use it AS-IS: ${sentenceResult}`;
	const imagePromptSingleLine = imagePrompt.replace(/\n/g, '');

	const image = await dalleThrottle(() => {
		console.log(perhapsUsernameWithMeaning, `Creating image: ${imagePromptSingleLine}`);
		return OpenAi.images.generate({
			model: 'dall-e-3',
			prompt: imagePrompt,
			quality: 'standard',
			size: '1024x1024',
			response_format: 'url',
		});
	});

	console.log(perhapsUsernameWithMeaning, 'Uploading image');
	console.log(perhapsUsernameWithMeaning, 'Revised prompt', image.data[0].revised_prompt);
	const url = image.data[0].url!;
	const uploadedImage = await cfUploader.fromURL(url, metadata);

	if (!uploadedImage.success) {
		console.log(perhapsUsernameWithMeaning, `Image upload failed: ${uploadedImage.message}`);
		return { success: false, message: 'Error' };
	}

	const finalUrl = `${process.env.CLOUDFLARE_IMAGES_URL}/${uploadedImage.result.id}.png`;
	console.log(perhapsUsernameWithMeaning, `Image uploaded: ${finalUrl}`);

	return {
		success: true,
		message: finalUrl,
		analysis: analysisResult,
		revisedPrompt: image.data[0].revised_prompt!,
	};
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

async function retryAsyncOperation<T, Args extends unknown[]>(
	asyncOperation: (...args: Args) => Promise<T>,
	maxRetries: number = 3,
	...args: Args
): Promise<T> {
	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await asyncOperation(...args);
		} catch (error) {
			if (error instanceof Error) {
				lastError = error;
			}
			if (attempt < maxRetries) {
				console.log(
					`[ERROR] Attempt ${attempt + 1} failed, retrying...: ${error instanceof Error ? error.message : error}`,
				);
			} else {
				console.log(
					`[ERROR] Attempt ${attempt + 1} failed, no more retries left: ${
						error instanceof Error ? error.message : error
					}`,
				);
			}
		}
	}

	throw lastError;
}

async function handleEventAndSendImageMessage(
	twitchBot: Bot,
	discordBot: DiscordClient,
	broadcasterName: string,
	target: string,
	gifting: boolean = false,
): Promise<void> {
	if (ignoreListManager.isUserIgnored(target.toLowerCase())) {
		console.log(`User ${target} is ignored, not generating image`);
		return;
	}
	const verb = gifting ? 'gifting' : 'subscribing';

	let imageResult: ImageGenerationResult;
	try {
		const metadata = { source: 'twitch', channel: broadcasterName, target: target, trigger: verb };
		imageResult = await retryAsyncOperation(generateImage, maxRetries, target, metadata);
	} catch (error) {
		imageResult = { success: false, message: 'Error' };
	}

	if (!imageResult.success) {
		await messagesThrottle(() => {
			return twitchBot.say(
				broadcasterName,
				`Thank you @${target} for ${verb} dnkLove Unfortunately, I was unable to generate an image for you.`,
			);
		});
		return;
	}
	const numImages = await storeImageData(broadcasterName, target, {
		image: imageResult.message,
		analysis: imageResult.analysis,
		revisedPrompt: imageResult.revisedPrompt,
		date: new Date().toISOString(),
	});

	try {
		discordBot.user!.setActivity({
			name: 'ImageGenerations',
			state: `🖼️ ${numImages} images generated`,
			type: ActivityType.Custom,
		});
	} catch (error) {
		console.log('Discord error', error);
	}

	for (const channelId of discordChannels) {
		const channel = discordBot.channels.cache.get(channelId);
		if (channel && channel.isTextBased()) {
			try {
				await channel.send(`Thank you @${target} for ${verb}. Here's your sweatling: ${imageResult.message}`);
			} catch (error) {
				console.log(`Error sending message to channel ${channelId}`, error);
			}
		}
	}

	await messagesThrottle(() => {
		console.log(`Sending ${verb} image`);

		return twitchBot.say(
			broadcasterName,
			`Thank you @${target} for ${verb} dnkLove This is for you: ${imageResult.message}`,
		);
	});
}

async function setUserCheer(broadcasterName: string, user: string, cheers: number) {
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
		console.log(`Error reading cheers count file at ${filePath}`, error);
	}
}

async function loadMeanings(filePath: PathLike) {
	try {
		const data = await fs.readFile(filePath, 'utf-8');
		const meanings = JSON.parse(data) as Record<string, string>;
		Object.entries(meanings).forEach(([user, meaning]) => {
			userMeaningMap.set(user, meaning);
		});
	} catch (error) {
		console.log(`Error reading meanings file at ${filePath}`, error);
	}
}

async function setMeaning(user: string, meaning: string) {
	userMeaningMap.set(user, meaning);
}

async function removeMeaning(user: string) {
	return userMeaningMap.delete(user);
}

async function saveMeanings(filePath: PathLike) {
	const meanings: Record<string, string> = {};
	userMeaningMap.forEach((meaning, user) => {
		meanings[user] = meaning;
	});

	await fs.writeFile(filePath, JSON.stringify(meanings, null, 4), 'utf-8');
}

function getUserMeaning(user: string) {
	return userMeaningMap.get(user) || user;
}

const truncate = (str: string, n: number) => (str.length > n ? `${str.substring(0, n - 1)}...` : str);

async function main() {
	try {
		const numImages = await getImageData(twitchChannels[0]);

		const discordBot = new DiscordClient({
			intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
			partials: [Partials.Channel, Partials.Message],
			presence: {
				activities: [
					{
						name: 'ImageGenerations',
						state: `🖼️ ${numImages.length} images generated`,
						type: ActivityType.Custom,
					},
				],
				status: 'online',
			},
		});

		discordBot.on(Events.ClientReady, async () => {
			console.log('Discord bot logged in.');
			try {
				const admin = discordBot.users.cache.get(discordAdmin);
				await admin?.createDM();
				console.log('Discord admin channel ready');
			} catch (error) {
				console.log('Discord error', error);
			}
		});
		discordBot.on(Events.MessageCreate, async (message) => {
			const admin = discordBot.users.cache.get(discordAdmin) ?? (await discordBot.users.fetch(discordAdmin));

			if (message.guild !== null) {
				return;
			}

			if (message.author.id === discordBot.user?.id) {
				return;
			}

			if (message.author.id !== discordAdmin) {
				await message.reply(`This communication channel is not monitored. Please contact ${admin} directly.`);
				return;
			}

			console.log(`Discord message received: ${message.content}`);
			const [command, ...params] = message.content.split(' ');
			if (command === '!announce') {
				const announcement = params.join(' ');
				if (!announcement) {
					await message.channel.send(`Please provide an announcement.`);
					return;
				}
				await message.reply(`Announcing: ${announcement}`);
				for (const channelId of discordChannels) {
					const channel = discordBot.channels.cache.get(channelId);
					if (channel && channel.isTextBased()) {
						try {
							await channel.send(announcement);
						} catch (error) {
							console.log(`Error sending message to channel ${channelId}`, error);
						}
					}
				}
			} else if (command === '!generateimage') {
				const broadcasterName = params[0];
				params.splice(0, 1);

				for (const param of params) {
					const metadata = { source: 'discord', channel: broadcasterName, target: param, trigger: 'custom' };
					const imageResult = await retryAsyncOperation(generateImage, maxRetries, param, metadata);
					if (!imageResult.success) {
						await message.reply(`Unable to generate image for ${param}`);
						continue;
					}
					const numImages = await storeImageData(broadcasterName, param, {
						image: imageResult.message,
						analysis: imageResult.analysis,
						revisedPrompt: imageResult.revisedPrompt,
						date: new Date().toISOString(),
					});

					try {
						discordBot.user!.setActivity({
							name: 'ImageGenerations',
							state: `🖼️ ${numImages} images generated`,
							type: ActivityType.Custom,
						});
					} catch (error) {
						console.log('Discord error', error);
					}

					for (const channelId of discordChannels) {
						const channel = discordBot.channels.cache.get(channelId);
						if (channel && channel.isTextBased()) {
							try {
								await channel.send(
									`Thank you @${param} for subscribing. Here's your sweatling: ${imageResult.message}`,
								);
							} catch (error) {
								console.log(`Error sending message to channel ${channelId}`, error);
							}
						}
					}
				}
			} else {
				await message.reply(`Unknown command.`);
			}
		});

		discordBot.login(process.env.DISCORD_BOT_TOKEN!).catch((error) => {
			console.log('Discord bot login failed', error);
		});

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
				console.log('Error reading token file, using default values.', error);
			}
		}

		const authProvider = new RefreshingAuthProvider({
			clientId: process.env.TWITCH_CLIENT_ID!,
			clientSecret: process.env.TWITCH_CLIENT_SECRET!,
		});

		authProvider.onRefresh(async (_userId, newTokenData) => {
			await fs.writeFile(tokenFilePath, JSON.stringify(newTokenData, null, 4), 'utf-8');
			tokenData = newTokenData;
		});
		await authProvider.addUserForToken(tokenData, ['chat']);

		const twitchBot = new Bot({
			authProvider,
			channels: twitchChannels,
			commands: [
				createBotCommand('aisweatling', async (params, { userName, broadcasterName, say }) => {
					if (!['partyhorst', broadcasterName.toLowerCase()].includes(userName.toLowerCase())) {
						return;
					}

					if (params.length === 0) {
						return;
					}

					const target = params[0].replace('@', '');
					if (ignoreListManager.isUserIgnored(target.toLowerCase())) {
						await messagesThrottle(() => {
							return say(`@${userName} ${target} does not partake in ai sweatlings.`);
						});
						return;
					}

					let imageResult: ImageGenerationResult;
					try {
						const metadata = { source: 'twitch', channel: broadcasterName, target: userName, trigger: 'custom' };
						imageResult = await retryAsyncOperation(generateImage, maxRetries, target, metadata);
					} catch (error) {
						imageResult = { success: false, message: 'Error' };
					}

					if (!imageResult.success) {
						await messagesThrottle(() => {
							return say(truncate(`Sorry, ${userName}, I was unable to generate an image for you.`, 500));
						});

						return;
					}
					const numImages = await storeImageData(broadcasterName, params[0], {
						image: imageResult.message,
						analysis: imageResult.analysis,
						revisedPrompt: imageResult.revisedPrompt,
						date: new Date().toISOString(),
					});

					try {
						discordBot.user!.setActivity({
							name: 'ImageGenerations',
							state: `🖼️ ${numImages} images generated`,
							type: ActivityType.Custom,
						});
					} catch (error) {
						console.log('Discord error', error);
					}

					for (const channelId of discordChannels) {
						const channel = discordBot.channels.cache.get(channelId);
						if (channel && channel.isTextBased()) {
							try {
								await channel.send(
									`@${userName} requested generation for @${target}. Here's the sweatling: ${imageResult.message}`,
								);
							} catch (error) {
								console.log(`Error sending message to channel ${channelId}`, error);
							}
						}
					}

					await messagesThrottle(() => {
						return say(`@${userName} Here's your image: ${imageResult.message}`);
					});
				}),
				createBotCommand('setmeaning', async (params, { userName, broadcasterName, say }) => {
					if (!['myndzi', broadcasterName.toLowerCase()].includes(userName.toLowerCase())) {
						return;
					}

					if (params.length < 2) {
						await messagesThrottle(() => {
							return say(`@${userName} Please provide a username and a meaning.`);
						});
						return;
					}

					const user = params[0];
					const meaning = params.slice(1).join(' ');

					await setMeaning(user.toLowerCase(), meaning);
					await saveMeanings(meaningsFilePath);

					await messagesThrottle(() => {
						return say(`@${userName} Meaning for ${user} set.`);
					});
				}),
				createBotCommand('delmeaning', async (params, { userName, broadcasterName, say }) => {
					if (!['myndzi', broadcasterName.toLowerCase()].includes(userName.toLowerCase())) {
						return;
					}

					if (params.length !== 1) {
						await messagesThrottle(() => {
							return say(`@${userName} Please provide a username.`);
						});
						return;
					}
					const user = params[0];
					const wasRemoved = await removeMeaning(user.toLowerCase());
					await saveMeanings(meaningsFilePath);

					await messagesThrottle(() => {
						if (!wasRemoved) {
							return say(`@${userName} Meaning for ${user} not found.`);
						}

						return say(`@${userName} Meaning for ${user} removed.`);
					});
				}),
				createBotCommand('getmeaning', async (params, { userName, say }) => {
					if (params.length !== 1) {
						await messagesThrottle(() => {
							return say(`@${userName} Please provide a username.`);
						});
						return;
					}

					const user = params[0];
					const meaning = getUserMeaning(user.toLowerCase());
					await messagesThrottle(() => {
						return say(`@${userName} ${user} means '${meaning}' dnkNoted`);
					});
				}),
				createBotCommand('noai', async (params, { userName, say }) => {
					await ignoreListManager.addToIgnoreList(userName.toLowerCase());

					await messagesThrottle(() => {
						return say(`@${userName} You will no longer receive AI sweatlings`);
					});
				}),
				createBotCommand('yesai', async (params, { userName, say }) => {
					await ignoreListManager.removeFromIgnoreList(userName.toLowerCase());

					await messagesThrottle(() => {
						return say(`@${userName} You will now receive AI sweatlings`);
					});
				}),
				createBotCommand('ping', async (params, { userName, say }) => {
					await messagesThrottle(() => {
						return say(`@${userName} pong`);
					});
				}),
				createBotCommand('say', async (params, { say }) => {
					await messagesThrottle(() => {
						return say(params.join(' '));
					});
				}),
			],
		});

		twitchBot.onConnect(() => {
			console.log(`Connected to ${twitchChannels.join(', ')}!`);
		});
		twitchBot.chat.onMessage(async (channel, user, _text, message) => {
			if (message.isCheer) {
				console.log(`Cheer received on ${channel} from ${user}! Bits: ${message.bits}`);
				await setUserCheer(channel, user, message.bits);
				await saveCheers(cheersCountFile);
			}
		});
		twitchBot.onSub(({ broadcasterName, userName }) => {
			console.log('onSub', broadcasterName, userName);
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, userName);
		});
		twitchBot.onResub(({ broadcasterName, userName }) => {
			console.log('onResub', broadcasterName, userName);
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, userName);
		});
		twitchBot.onGiftPaidUpgrade(({ broadcasterName, userName }) => {
			console.log('onGiftPaidUpgrade', broadcasterName, userName);
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, userName);
		});
		twitchBot.onPrimePaidUpgrade(({ broadcasterName, userName }) => {
			console.log('onPrimePaidUpgrade', broadcasterName, userName);
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, userName);
		});
		twitchBot.onStandardPayForward(({ broadcasterName, gifterName }) => {
			console.log('onStandardPayForward', broadcasterName, gifterName);
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, gifterName, true);
		});
		twitchBot.onCommunityPayForward(({ broadcasterName, gifterName }) => {
			console.log('onCommunityPayForward', broadcasterName, gifterName);
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, gifterName, true);
		});
		twitchBot.onCommunitySub(({ broadcasterName, gifterName }) => {
			console.log('onCommunitySub', broadcasterName, gifterName || 'Anonymous');
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, gifterName || 'Anonymous', true);
		});
		twitchBot.onSubGift(({ broadcasterName, userName }) => {
			console.log('onSubGift', broadcasterName, userName);
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, userName);
		});
	} catch (error: unknown) {
		if (error instanceof InvalidTokenError) {
			console.log('Invalid tokens, please check your environment variables');
			return;
		} else if (error instanceof Error) {
			console.trace(error);
		} else {
			console.log(error);
		}
	}
}

const appRootDir = await getAppRootDir();
const tokenFilePath = path.join(appRootDir, 'data', 'tokens.json');
const cheersCountFile = path.join(appRootDir, 'data', 'cheers.json');
const imagesFilePath = path.join(appRootDir, 'data', 'images.json');
const meaningsFilePath = path.join(appRootDir, 'data', 'meanings.json');
const ignoreFilePath = path.join(appRootDir, 'data', 'ignore.json');
const logFilePath = path.join(appRootDir, 'data', 'log.txt');

const OpenAi = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});
const cfUploader = new CloudflareUploader(process.env.CLOUDFLARE_ACCOUNT_ID!, process.env.CLOUDFLARE_API_TOKEN!);
const twitchChannels = process.env.TWITCH_CHANNELS!.split(',');
const discordChannels = process.env.DISCORD_CHANNELS!.split(',');
const discordAdmin = process.env.DISCORD_ADMIN_USER_ID!;
const analyzerPrompt = process.env.OPENAI_ANALYZER_PROMPT!;
const scenarioPrompt = process.env.OPENAI_SCENARIO_PROMPT!;
const userCheerMap: UserCheerMap = new Map();
const userMeaningMap: UserMeaningMap = new Map();
const ignoreListManager = new IgnoreListManager(ignoreFilePath);
const messagesThrottle = throttledQueue(20, 30 * 1000, true);
const openaiThrottle = throttledQueue(30, 60 * 1000, true);
const imagesPerMinute = parseInt(process.env.OPENAI_IMAGES_PER_MINUTE!, 10);
const maxRetries = parseInt(process.env.MAX_RETRIES!, 10);

/*
 * DALL-E throttling
 * Tier 1: 5 requests per minute
 * Tier 2: 7 requests per minute
 * Tier 3: 7 requests per minute
 * Tier 4: 15 requests per minute
 * Tier 5: 50 requests per minute
 */
const dalleThrottle = throttledQueue(imagesPerMinute, 60 * 1000, true);

try {
	const originalLog = console.log;
	console.log = (...args: unknown[]) => {
		const now = new Date().toISOString();
		fs.appendFile(logFilePath, `[${now}] ${args.join(' ')}\n`);
		originalLog(`[${now}]`, ...args);
	};

	await Promise.all([
		ensureFileExists(tokenFilePath),
		ensureFileExists(cheersCountFile, JSON.stringify({ cheers: [] })),
		ensureFileExists(imagesFilePath, JSON.stringify({})),
		ensureFileExists(ignoreFilePath, JSON.stringify([])),
		ensureFileExists(meaningsFilePath, JSON.stringify({})),
		ignoreListManager.loadIgnoreList(),
	]);

	await loadCheers(cheersCountFile);
	await loadMeanings(meaningsFilePath);

	console.log(`Using token file: ${tokenFilePath}`);
	console.log(`Using cheers count file: ${cheersCountFile}`);
	console.log(`Using images file: ${imagesFilePath}`);
	console.log(`Using meanings file: ${meaningsFilePath}`);
	console.log(`Using ignore file: ${ignoreFilePath}`);

	await main();
} catch (error: unknown) {
	if (error instanceof Error) {
		console.error(error.message);
	}
}
