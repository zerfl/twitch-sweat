import 'dotenv/config';
import * as path from 'path';
import { PathLike, promises as fs } from 'fs';
import OpenAI, { BadRequestError } from 'openai';
import imgur from 'imgur';
import { fileURLToPath } from 'url';
import { AccessToken, InvalidTokenError, RefreshingAuthProvider } from '@twurple/auth';
import { Bot, createBotCommand } from '@twurple/easy-bot';
// import { ApiClient } from '@twurple/api';
import { Client as DiscordClient, Events, GatewayIntentBits } from 'discord.js';
import throttledQueue from 'throttled-queue';

const requiredEnvVars = [
	'OPENAI_API_KEY',
	'IMGUR_CLIENT_ID',
	'TWITCH_CLIENT_ID',
	'TWITCH_CLIENT_SECRET',
	'TWITCH_CHANNELS',
	'TWITCH_ACCESS_TOKEN',
	'TWITCH_REFRESH_TOKEN',
	'IMAGES_PER_MINUTE',
	'DISCORD_BOT_TOKEN',
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
type UserMeaningMap = Map<string, string>;

const OpenAi = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY,
});

// @ts-expect-error imgur types are outdated
const Imgur = new imgur.ImgurClient({
	clientId: process.env.IMGUR_CLIENT_ID,
});

const twitchChannels = process.env.TWITCH_CHANNELS!.split(',');
const discordChannels = process.env.DISCORD_CHANNELS!.split(',');
const userCheerMap: UserCheerMap = new Map();
const userMeaningMap: UserMeaningMap = new Map();
const messagesThrottle = throttledQueue(20, 30 * 1000, true);
//TODO: change this whenever the open ai account tier changes, thus changing the rate limit
/*
 * DALL-E throttling
 * Tier 1: 5 requests per minute
 * Tier 2: 7 requests per minute
 * Tier 3: 7 requests per minute
 * Tier 4: 15 requests per minute
 * Tier 5: 50 requests per minute
 */
// convert process.env.IMAGES_PER_MINUTE string to number
const imagesPerMinute = parseInt(process.env.IMAGES_PER_MINUTE!, 10);
const dalleThrottle = throttledQueue(imagesPerMinute, 60 * 1000, true);


async function ensureFileExists(filePath: string, defaultContent: string = ''): Promise<void> {
	try {
		await fs.access(filePath);
	} catch {
		await fs.writeFile(filePath, defaultContent, 'utf-8');
	}
}

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

	const perhapsUsernameWithMeaning = getUserMeaning(username.toLowerCase());

	try {
		console.log(`Analysing text: ${username} / ${perhapsUsernameWithMeaning}`);
		const analysisPrompt = `Analyze the provided text to automatically identify words in them. You'll be given a unique username. Always provide a useful interpretation or insight into the word's possible meaning and structure. Consider case sensitivity. Always return a single and concise sentence that encapsulates the potential meaning and structure of the username.`;
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

		const imagePrompt = `I NEED to test how the tool works with extremely simple prompts. DO NOT add any detail, just use it AS-IS: A vibrant blue sweatling, with a completely round head, wearing an orange hoodie and holding a heart in one hand. The sweatling's skin is smooth and flawless. Nearby is a sign that reads '${username}' in bold letters. ${sentenceResult} The style of the image features watercolor strokes and clear lines, complemented by pixel art for the sweatling. Achieve refined curves and intricate details. Employ a vibrant color palette with specific shades for highlights and shadows to provide depth. Ensure outlines are clean and dark for crisp definition. The composition should be coherent and polished, reflecting a modern take on the watercolor and pixel art style with a seamless visual flow.`;
		const image = await dalleThrottle(() => {
			console.log(`Creating image: ${imagePrompt}`);
			return OpenAi.images.generate({
				model: 'dall-e-3',
				prompt: imagePrompt,
				quality: 'standard',
				size: '1024x1024',
				response_format: 'url',
			});
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

async function handleEventAndSendImageMessage(twitchBot: Bot, discordBot: DiscordClient, broadcasterName: string, userName: string, gifting: boolean = false): Promise<void> {
	const verb = gifting ? 'gifting' : 'subscribing';

	const imageResult = await generateImage(userName);
	if (!imageResult.success) {
		await messagesThrottle(() => {
				return twitchBot.say(broadcasterName,
					`Thank you @${userName} for ${verb} dnkLove Unfortunately, I was unable to generate an image for you.`,
				);
			},
		);
		return;
	}
	await storeImageData(broadcasterName, userName, imageResult.message);


	for (const channelId of discordChannels) {
		const channel = discordBot.channels.cache.get(channelId);
		if (channel && channel.isTextBased()) {
			try {
				await channel.send(`Thank you @${userName} for ${verb}. Here's your sweatling: ${imageResult.message}`);
			} catch (error) {
				console.log(`Error sending message to channel ${channelId}`, error);
			}
		}
	}


	await messagesThrottle(() => {
		console.log(`Sending ${verb} image`);

		return twitchBot.say(broadcasterName,
			`Thank you @${userName} for ${verb} dnkLove This is for you: ${imageResult.message}`,
		);
	});
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
		const discordBot = new DiscordClient({
			intents: [GatewayIntentBits.Guilds],
		});

		discordBot.on(Events.ClientReady, () => {
			console.log('Discord bot logged in.');
			discordBot.user!.setPresence({ activities: [{ name: 'Noita' }], status: 'online' });
		});
		await discordBot.login(process.env.DISCORD_BOT_TOKEN!);


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

		const twitchBot = new Bot({
			authProvider,
			channels: twitchChannels,
			commands: [
				createBotCommand('aisweatling', async (params, { userName, broadcasterName, say }) => {
					if (!['partyhorst', 'dunkorslam'].includes(userName.toLowerCase())) {
						return;
					}

					if (params.length === 0) {
						return;
					}

					const target = params[0].replace('@', '');
					const { success, message } = await generateImage(target);
					if (!success) {
						await messagesThrottle(() => {
							return say(truncate(`Sorry, ${userName}, I was unable to generate an image for you: ${message}`, 500));
						});

						return;
					}
					await storeImageData(broadcasterName, params[0], message);

					for (const channelId of discordChannels) {
						const channel = discordBot.channels.cache.get(channelId);
						if (channel && channel.isTextBased()) {
							try {
								await channel.send(`@${userName} requested generation for @${target}. Here's the sweatling: ${message}`);
							} catch (error) {
								console.log(`Error sending message to channel ${channelId}`, error);
							}
						}
					}

					await messagesThrottle(() => {
						return say(`@${userName} Here's your image: ${message}`);
					});
				}),
				createBotCommand('setmeaning', async (params, { userName, say }) => {
					if (!['myndzi', 'dunkorslam'].includes(userName.toLowerCase())) {
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
				createBotCommand('delmeaning', async (params, { userName, say }) => {
					if (!['myndzi', 'dunkorslam'].includes(userName.toLowerCase())) {
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
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, userName);
		});
		twitchBot.onResub(({ broadcasterName, userName }) => {
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, userName);
		});
		twitchBot.onGiftPaidUpgrade(({ broadcasterName, userName }) => {
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, userName);
		});
		twitchBot.onPrimePaidUpgrade(({ broadcasterName, userName }) => {
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, userName);
		});
		twitchBot.onStandardPayForward(({ broadcasterName, gifterName }) => {
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, gifterName, true);
		});
		twitchBot.onCommunityPayForward(({ broadcasterName, gifterName }) => {
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, gifterName, true);
		});

		twitchBot.onCommunitySub(({ broadcasterName, gifterName }) => {
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, gifterName || 'Anonymous', true);
		});

		twitchBot.onSubGift(({ broadcasterName, userName }) => {
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, userName);
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
let meaningsFilePath: string = '';

try {
	appRootDir = await getAppRootDir();
	tokenFilePath = path.join(appRootDir, 'data', 'tokens.json');
	cheersCountFile = path.join(appRootDir, 'data', 'cheers.json');
	imagesFilePath = path.join(appRootDir, 'data', 'images.json');
	meaningsFilePath = path.join(appRootDir, 'data', 'meanings.json');

	await Promise.all([
		ensureFileExists(tokenFilePath),
		ensureFileExists(cheersCountFile, JSON.stringify({ cheers: [] })),
		ensureFileExists(imagesFilePath, JSON.stringify({})),
		ensureFileExists(meaningsFilePath, JSON.stringify({})),
	]);

	await loadCheers(cheersCountFile);
	await loadMeanings(meaningsFilePath);

	console.log(`Using token file: ${tokenFilePath}`);
	console.log(`Using cheers count file: ${cheersCountFile}`);
	console.log(`Using images file: ${imagesFilePath}`);
	console.log(`Using meanings file: ${meaningsFilePath}`);

	await main();
} catch (error: unknown) {
	if (error instanceof Error) {
		console.error(error.message);
	}
}
