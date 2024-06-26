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
import { OpenAIManager } from './utils/OpenAIManager';
import { nanoid } from 'nanoid';

const requiredEnvVars = [
	'TWITCH_CLIENT_ID',
	'TWITCH_CLIENT_SECRET',
	'TWITCH_CHANNELS',
	'TWITCH_ACCESS_TOKEN',
	'TWITCH_REFRESH_TOKEN',
	'OPENAI_API_KEY',
	'OPENAI_IMAGES_PER_MINUTE',
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
	[broadcaster: string]: {
		[user: string]: SingleImage[];
	};
};

type UserMeaningMap = Map<string, string>;
type BroadcasterThemeMap = Map<string, string>;

async function ensureFileExists(filePath: string, defaultContent: string = ''): Promise<void> {
	try {
		await fs.access(filePath);
	} catch {
		await fs.writeFile(filePath, defaultContent, 'utf-8');
	}
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

	broadcasterImageData[broadcaster] = {
		...(broadcasterImageData[broadcaster] || {}),
		[user]: userImages,
	};

	await fs.writeFile(imagesFilePath, JSON.stringify(broadcasterImageData, null, 4), 'utf-8');

	let totalImages = 0;
	for (const user in broadcasterImageData[broadcaster]) {
		totalImages += broadcasterImageData[broadcaster][user].length;
	}

	return totalImages;
}

async function generateImage(
	username: string,
	metadata: Record<string, unknown> = {},
	theme: string,
	style: string | null = null,
): Promise<ImageGenerationResult> {
	const uniqueId = nanoid(14);

	const userMeaning = getUserMeaning(username.toLowerCase());
	const queryMessage =
		userMeaning !== username
			? `Literal username: ${username}\nIntended meaning: ${userMeaning}`
			: `Username: ${username}`;

	const queryAnalzerPrompt = analyzerPrompt.replace('__DATE__', new Date().toISOString().slice(0, 10));
	const analysisMessages: OpenAI.ChatCompletionMessageParam[] = [
		{
			role: 'system',
			content: queryAnalzerPrompt,
		},
		{
			role: 'user',
			content: queryMessage,
		},
	];

	let analysisResult = await openaiThrottle(() => {
		console.log(`[${uniqueId}]`, userMeaning, `Analysing text: ${username} / ${userMeaning}`);
		return openAIManager.getChatCompletion(analysisMessages, 400);
	});

	/*
	 * If the analysis doesn't end in a period, the next LLM prompt may not be generated correctly as
	 * it tries to continue the sentence. This is a workaround to ensure the analysis ends in a period.
	 *
	 * Another solution would be by changing the way we provide the analysis result to the LLM.
	 *
	 */
	if (!analysisResult.endsWith('.')) {
		analysisResult += '.';
	}

	if (theme) {
		console.log(`[${uniqueId}]`, userMeaning, `Original analysis: ${analysisResult}`);

		const themeMessages: OpenAI.ChatCompletionMessageParam[] = [
			{
				role: 'system',
				content: themePrompt.replace('__THEME_', theme),
			},
			{
				role: 'user',
				content: analysisResult,
			},
		];
		analysisResult = await openaiThrottle(() => {
			console.log(`[${uniqueId}]`, userMeaning, `Adding theme: ${theme} / ${analysisResult}`);
			return openAIManager.getChatCompletion(themeMessages, 400);
		});
	}

	analysisResult = `- Literal username: ${username}\n${analysisResult}`;

	let template;
	if (style) {
		template = dalleTemplates.find((t) => t.keyword.toLowerCase() === style!.toLowerCase());
	}
	if (!template) {
		const templateIndex = Math.floor(Math.random() * dalleTemplates.length);
		template = dalleTemplates[templateIndex] as DalleTemplate;
		style = template.keyword.toLowerCase();
	}
	const queryScenarioPrompt = scenarioPrompt
		.replace('__STYLE_NAME__', template.name)
		.replace('__STYLE_TEMPLATE__', template.value);

	console.log(`[${uniqueId}]`, userMeaning, `Using template: ${template.name}`);
	console.log(`[${uniqueId}]`, userMeaning, `Analysed text: ${analysisResult}`);

	const sentenceResult = await openaiThrottle(() => {
		const generatePromptMessages: OpenAI.ChatCompletionMessageParam[] = [
			{
				role: 'system',
				content: queryScenarioPrompt,
			},
			{
				role: 'user',
				content: analysisResult,
			},
		];
		return openAIManager.getChatCompletion(generatePromptMessages, 400);
	});

	console.log(`[${uniqueId}]`, userMeaning, `Generated sentence: ${sentenceResult}`);

	const imagePrompt = `I NEED to test how the tool works with extremely simple prompts. DO NOT add any detail, just use it AS-IS: ${sentenceResult}`;

	const imagePromptSingleLine = imagePrompt.replace(/\n/g, '');

	const image = await dalleThrottle(() => {
		console.log(`[${uniqueId}]`, userMeaning, `Creating image: ${imagePromptSingleLine}`);
		return openAIManager.generateImage({
			model: 'dall-e-3',
			prompt: imagePrompt,
			quality: 'standard',
			size: '1024x1024',
			response_format: 'url',
		});
	});

	console.log(`[${uniqueId}]`, userMeaning, 'Uploading image');
	console.log(`[${uniqueId}]`, userMeaning, 'Revised prompt', image.data[0].revised_prompt);
	const url = image.data[0].url!;

	const updatedMetadata = {
		...metadata,
		theme: theme,
		style: style,
	};

	const uploadedImage = await cfUploader.uploadImageFromUrl(url, updatedMetadata);

	if (!uploadedImage.success) {
		console.log(`[${uniqueId}]`, userMeaning, `Image upload failed: ${uploadedImage.errors}`);
		return { success: false, message: 'Error' };
	}

	const finalUrl = `${process.env.CLOUDFLARE_IMAGES_URL}/${uploadedImage.result.id}.png`;
	console.log(`[${uniqueId}]`, userMeaning, `Image uploaded: ${finalUrl}`);

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
		const theme = getBroadcasterTheme(broadcasterName);
		imageResult = await retryAsyncOperation(generateImage, maxRetries, target, metadata, theme);
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
	await storeImageData(broadcasterName, target, {
		image: imageResult.message,
		analysis: imageResult.analysis,
		revisedPrompt: imageResult.revisedPrompt,
		date: new Date().toISOString(),
	});

	for (const channelId of discordChannels) {
		const channel = discordBot.channels.cache.get(channelId);
		if (channel && channel.isTextBased()) {
			try {
				await channel.send(`Thank you \`${target}\` for ${verb}. Here's your sweatling: ${imageResult.message}`);
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

async function loadThemes(filePath: PathLike) {
	try {
		const data = await fs.readFile(filePath, 'utf-8');
		const meanings = JSON.parse(data) as Record<string, string>;
		Object.entries(meanings).forEach(([broadcaster, theme]) => {
			broadcasterThemeMap.set(broadcaster, theme);
		});
	} catch (error) {
		console.log(`Error reading themes file at ${filePath}`, error);
	}
}

async function setTheme(broadcaster: string, theme: string) {
	broadcasterThemeMap.set(broadcaster, theme);
}

async function removeTheme(broadcaster: string) {
	return broadcasterThemeMap.delete(broadcaster);
}

async function saveThemes(filePath: PathLike) {
	const themes = Object.fromEntries(broadcasterThemeMap);
	await fs.writeFile(filePath, JSON.stringify(themes, null, 4), 'utf-8');
}

function getBroadcasterTheme(broadcaster: string) {
	return broadcasterThemeMap.get(broadcaster) || '';
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
	const meanings = Object.fromEntries(userMeaningMap);
	await fs.writeFile(filePath, JSON.stringify(meanings, null, 4), 'utf-8');
}

function getUserMeaning(user: string) {
	return userMeaningMap.get(user) || user;
}

const truncate = (str: string, n: number) => (str.length > n ? `${str.substring(0, n - 1)}...` : str);

async function main() {
	try {
		const discordBot = new DiscordClient({
			intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
			partials: [Partials.Channel, Partials.Message],
			presence: {
				activities: [
					{
						name: 'ImageGenerations',
						state: `🖼️ generating images`,
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
				const theme = getBroadcasterTheme(broadcasterName);
				params.splice(0, 1);

				for (const param of params) {
					const metadata = {
						source: 'discord',
						channel: broadcasterName,
						target: param,
						trigger: 'custom',
					};
					const imageResult = await retryAsyncOperation(generateImage, maxRetries, param, metadata, theme);
					if (!imageResult.success) {
						await message.reply(`Unable to generate image for ${param}`);
						continue;
					}
					await storeImageData(broadcasterName, param, {
						image: imageResult.message,
						analysis: imageResult.analysis,
						revisedPrompt: imageResult.revisedPrompt,
						date: new Date().toISOString(),
					});

					for (const channelId of discordChannels) {
						const channel = discordBot.channels.cache.get(channelId);
						if (channel && channel.isTextBased()) {
							try {
								await channel.send(
									`Thank you \`${param}\` for subscribing. Here's your sweatling: ${imageResult.message}`,
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
		authProvider.onRefreshFailure((error) => {
			console.log('Error refreshing token', error);
		});

		await authProvider.addUserForToken(tokenData, ['chat']);

		const twitchBot = new Bot({
			authProvider,
			channels: twitchChannels,
			commands: [
				createBotCommand('aisweatling', async (params, { userName, broadcasterName, say }) => {
					if (!['partyhorst', broadcasterName.toLowerCase()].includes(userName.toLowerCase())) return;
					if (params.length === 0) return;

					const target = params[0].replace('@', '');
					if (ignoreListManager.isUserIgnored(target.toLowerCase())) {
						await messagesThrottle(() => {
							return say(`@${userName} ${target} does not partake in ai sweatlings.`);
						});
						return;
					}

					// is the nullish coalescing operator really necessary here? if no style was provided, it would be undefined, not null. both falsy, but still...
					// i want the intent to be clear, so i'll leave it in for now
					const specifiedStyle = params[1] ?? null;

					let imageResult: ImageGenerationResult;
					try {
						const metadata = {
							source: 'twitch',
							channel: broadcasterName,
							target: target,
							trigger: 'custom',
						};
						const theme = getBroadcasterTheme(broadcasterName);
						imageResult = await retryAsyncOperation(generateImage, maxRetries, target, metadata, theme, specifiedStyle);
					} catch (error) {
						imageResult = { success: false, message: 'Error' };
					}

					if (!imageResult.success) {
						await messagesThrottle(() => {
							return say(truncate(`Sorry, ${userName}, I was unable to generate an image for you.`, 500));
						});

						return;
					}
					await storeImageData(broadcasterName, params[0], {
						image: imageResult.message,
						analysis: imageResult.analysis,
						revisedPrompt: imageResult.revisedPrompt,
						date: new Date().toISOString(),
					});

					try {
						discordBot.user!.setActivity({
							name: 'ImageGenerations',
							state: `🖼️ generating images`,
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
									`@${userName} requested generation for \`${target}\`. Here's the sweatling: ${imageResult.message}`,
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
				createBotCommand('settheme', async (params, { userName, broadcasterName, say }) => {
					if (userName.toLowerCase() !== broadcasterName.toLowerCase()) return;
					if (params.length === 0) {
						await messagesThrottle(() => {
							return say(`@${userName} Please provide a theme.`);
						});
						return;
					}

					const theme = params.join(' ');
					await setTheme(broadcasterName.toLowerCase(), theme);
					await saveThemes(themeFilePath);

					await messagesThrottle(() => {
						return say(`@${userName} Theme set to: ${theme}`);
					});
				}),
				createBotCommand('deltheme', async (_params, { userName, broadcasterName, say }) => {
					if (userName.toLowerCase() !== broadcasterName.toLowerCase()) return;

					await removeTheme(broadcasterName.toLowerCase());
					await saveThemes(themeFilePath);

					await messagesThrottle(() => {
						return say(`@${userName} Theme removed.`);
					});
				}),
				createBotCommand('gettheme', async (_params, { userName, broadcasterName, say }) => {
					const theme = getBroadcasterTheme(broadcasterName.toLowerCase());
					await messagesThrottle(() => {
						if (!theme) {
							return say(`@${userName} No theme set.`);
						}

						return say(`@${userName} Current theme: ${theme}`);
					});
				}),
				createBotCommand('setmeaning', async (params, { userName, broadcasterName, say }) => {
					if (!['myndzi', 'partyhorst', broadcasterName.toLowerCase()].includes(userName.toLowerCase())) return;
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
					if (!['myndzi', 'partyhorst', broadcasterName.toLowerCase()].includes(userName.toLowerCase())) return;

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
				createBotCommand('noai', async (_params, { userName, say }) => {
					await ignoreListManager.addToIgnoreList(userName.toLowerCase());

					await messagesThrottle(() => {
						return say(`@${userName} You will no longer receive AI sweatlings`);
					});
				}),
				createBotCommand('yesai', async (_params, { userName, say }) => {
					await ignoreListManager.removeFromIgnoreList(userName.toLowerCase());

					await messagesThrottle(() => {
						return say(`@${userName} You will now receive AI sweatlings`);
					});
				}),
				createBotCommand('ping', async (_params, { userName, say }) => {
					if (userName.toLowerCase() !== 'partyhorst') return;

					await messagesThrottle(() => {
						return say(`@${userName} pong`);
					});
				}),
				createBotCommand('say', async (params, { say, userName }) => {
					if (userName.toLowerCase() !== 'partyhorst') return;
					if (params.length === 0) return;

					await messagesThrottle(() => {
						return say(params.join(' '));
					});
				}),
				createBotCommand('uguu', async (_params, { say, userName }) => {
					if (userName.toLowerCase() !== 'partyhorst') return;

					await messagesThrottle(() => {
						return say(`!uguu`);
					});
				}),
				createBotCommand('myai', async (_params, { userName, say }) => {
					await messagesThrottle(() => {
						return say(
							`@${userName} You can browse your AI sweatlings in the discord or at https://www.curvyspiderwife.com/user/${userName} dnkLove`,
						);
					});
				}),
			],
		});

		twitchBot.onDisconnect((manually, reason) => {
			console.log(`[ERROR] Disconnected from Twitch: ${manually} ${reason}`);
		});
		twitchBot.onConnect(() => {
			console.log(`Connected to ${twitchChannels.join(', ')}!`);
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
const imagesFilePath = path.join(appRootDir, 'data', 'images.json');
const meaningsFilePath = path.join(appRootDir, 'data', 'meanings.json');
const themeFilePath = path.join(appRootDir, 'data', 'themes.json');
const ignoreFilePath = path.join(appRootDir, 'data', 'ignore.json');
const logFilePath = path.join(appRootDir, 'data', 'log.txt');

const openAIManager = new OpenAIManager(process.env.OPENAI_API_KEY!, process.env.CLOUDFLARE_AI_GATEWAY);
const cfUploader = new CloudflareUploader(process.env.CLOUDFLARE_ACCOUNT_ID!, process.env.CLOUDFLARE_API_TOKEN!);
const twitchChannels = process.env.TWITCH_CHANNELS!.split(',');
const discordChannels = process.env.DISCORD_CHANNELS!.split(',');
const discordAdmin = process.env.DISCORD_ADMIN_USER_ID!;
const userMeaningMap: UserMeaningMap = new Map();
const broadcasterThemeMap: BroadcasterThemeMap = new Map();
const ignoreListManager = new IgnoreListManager(ignoreFilePath);
const messagesThrottle = throttledQueue(20, 30 * 1000, true);
const openaiThrottle = throttledQueue(30, 60 * 1000, true);
const imagesPerMinute = parseInt(process.env.OPENAI_IMAGES_PER_MINUTE!, 10);
const maxRetries = parseInt(process.env.MAX_RETRIES!, 10);

type DalleTemplate = {
	name: string;
	keyword: string;
	value: string;
};

const analyzerPrompt = `Today is __DATE__.

Step 1: Interpret the username
- Break down the username into its component words and phrases
- Consider common memes, abbreviations, cultural references, and linguistic interpretations
- Identify the key themes, emotions, or ideas conveyed by the username
- Provide a brief, insightful and literal interpretation of the username in a single sentence
- Avoid quote marks or unnecessary punctuation

Step 2: Create the avatar
- Describe the avatar's facial expression in one sentence, including the eyes, mouth, and overall mood
- Describe the avatar's posture in one sentence
- Choose an outfit that directly connects to the username's key themes or ideas, with a bias towards an orange hoodie unless another outfit more vividly reflects the username
- Describe the avatar's outfit in one sentence
- Add unique accessories or features that enhance the avatar's connection to the username

Step 3: Generate the scene
- Use the key themes, emotions, and ideas from the username interpretation to create a directly relevant setting
- Incorporate the literal meaning of the username into the scene
- Focus on the core elements of the username interpretation when generating the scene, avoiding unrelated elements
- Ensure that the connection between the username and the scene is clear and obvious to the reader, without requiring excessive thought or interpretation
- Describe the detailed background scene in 2-3 sentences, focusing on elements that directly reflect the username's meaning and invoke laughter and amusement

Use this format for your response:
- Username interpretation:
- Avatar's expression:
- Avatar's posture:
- Avatar's outfit:
- Avatar's accessories or features:
- Scene description:`;

const themePrompt = `Provided to you is the interpretation of a username, including details for a scene. Your task it to subtly infuse the provided details of the avatar and scene with today's theme: "__THEME_". The original avatar's interpretation must be preserved, with the theme integrated into the scene's environment. You must ensure that the original interpretation and the username remain unchanged.

Use this format:
- Avatar's expression:
- Avatar's posture:
- Avatar's outfit:
- Avatar's accessories or features:
- Scene description:`;

const scenarioPrompt = `I'll provide a template enclosed in triple quotes. Populate the bracketed placeholders in the template with creative details derived from the provided information, using clear and direct language. Focus on key elements of the username and skip redundant phrases. Use precise and targeted language. Clearly convey the placement and role of specific objects in relation to the scene.

Replace the placeholders strictly with the relevant information, without introducing any additional formatting or making changes to the template's structure. If a placeholder doesn't have a direct correspondence with the provided information, use your best judgment to fill it in while staying true to the overall theme and style.

The rest of the template, including the original wording, base prompt, and the image style defined as __STYLE_NAME__, must remain unchanged.

Template: """__STYLE_TEMPLATE__"""

Instructions:
- Fill in each placeholder with clear, direct language that resonates with the overall theme and style indicated.
- Only replace the text within the brackets []. Do not alter the template's wording or structure.
- Provide a response suitable for immediate use, reflecting the specified style and theme.
- Quotes may be placed around the literal username only.

Please provide only the processed text, without any additional preamble or explanations.`;

const dalleTemplates: DalleTemplate[] = [
	{
		name: 'illustration',
		keyword: 'illustration',
		value:
			"Illustration of a cute BLUE round-faced character, with blue skin, wearing [avatar outfit], [avatar actions], and showing [avatar expression] in [avatar posture]. The scene is set in [avatar scene and environment], with a '[literal_username]' banner adding to the vibrant, illustrated atmosphere.",
	},
	{
		name: 'watercolor',
		keyword: 'watercolor',
		value:
			"Watercolor painting of a cute BLUE round-faced character, with blue skin, dressed in [avatar outfit], [avatar actions], with [avatar expression] in [avatar posture]. The soft, fluid background depicts [avatar scene and environment], with a '[literal_username]' banner enhancing the delicate watercolor style.",
	},
	{
		name: 'pixel art',
		keyword: 'pixel',
		value:
			"Pixel art scene featuring a cute BLUE round-faced character, with blue skin, in [avatar outfit], [avatar actions], with [avatar expression] in [avatar posture]. The pixelated background showcases [avatar scene and environment], with a '[literal_username]' banner rendered in sharp pixel detail.",
	},
	{
		name: 'oil painting',
		keyword: 'oil',
		value:
			"Oil painting of a cute BLUE round-faced character, with blue skin, dressed in [avatar outfit], [avatar actions], showing [avatar expression] in [avatar posture]. The rich, textured background depicts [avatar scene and environment], with a an artistically integrated '[literal_username]' banner.",
	},
	{
		name: 'flat',
		keyword: 'flat',
		value:
			"Flat design illustration of a cute BLUE round-faced character, with blue skin, in [avatar outfit], [avatar actions], portraying [avatar expression] in [avatar posture]. The simplistic background features bold colors and [avatar scene and environment], with a a boldly styled '[literal_username]' banner.",
	},
	{
		name: 'glitch art',
		keyword: 'glitch',
		value:
			"Glitch art illustration featuring a cute BLUE round-faced character, with blue skin, in [avatar outfit], displaying [avatar expression] in [avatar posture]. The backdrop showcases [avatar scene and environment] with vibrant glitches, intermingling a '[literal_username]' banner with digital distortions.",
	},
	{
		name: 'Byzantine art',
		keyword: 'byzantine',
		value:
			"Byzantine-inspired illustration of a cute BLUE round-faced character, with blue skin, in [avatar outfit], [avatar actions], with [avatar expression] in [avatar posture]. The golden and vibrant background depicts [avatar scene and environment], with a an ornate '[literal_username]' banner.",
	},
	{
		name: 'expressionism',
		keyword: 'expressionism',
		value:
			"Expressionist drawing of a cute BLUE round-faced character, with blue skin, in [avatar outfit], [avatar actions], showing exaggerated [avatar expression] in [avatar posture]. The background features [avatar scene and environment], with a an expressive '[literal_username]' banner.",
	},
	{
		name: 'charcoal',
		keyword: 'charcoal',
		value:
			'Charcoal drawing of a cute BLUE round-faced character, with blue skin, dressed in [avatar outfit], showing deep [avatar expression] in [avatar posture]. The raw textured background depicts [avatar scene and environment], with a a bold "[literal_username]" banner sketched in bold strokes.',
	},
	{
		name: 'neon graffiti',
		keyword: 'neon',
		value:
			'Illustration of a neon graffiti scene featuring a cute BLUE round-faced character, with blue skin, in [avatar outfit], [avatar actions], with [avatar expression] in [avatar posture]. The urban backdrop showcases [avatar scene and environment], with a a luminous "[literal_username]" banner shining with neon vibrancy.',
	},
	{
		name: 'vintage manga',
		keyword: 'vintagemanga',
		value:
			'1980s vintage manga still frame depicting a cute BLUE round-faced character, with blue skin, in [avatar outfit], [avatar actions], showing [avatar expression] in [avatar posture]. The backdrop features [avatar scene and environment] with cell shading, capturing a grainy and vintage look with overlapping visual channels. A a "[literal_username]" banner are styled in VHS quality.',
	},
	{
		name: 'Rumiko Takahashi style',
		keyword: 'takahashi',
		value:
			'Illustration featuring a cute BLUE round-faced character, with blue skin, in [avatar outfit], [avatar actions], with [avatar expression] in [avatar posture]. The grainy, surreal background depicts [avatar scene and environment] with cell shading and vintage anime elements, including a a "[literal_username]" banner adding thematic depth. Visual style reminiscent of exaggeration, bold lines, and vivid colors, similar to those seen in common late 19th century illustrations mainly created using ink on paper.',
	},
	{
		name: 'Yoshiyuki Sadamoto style',
		keyword: 'sadamoto',
		value:
			'Dystopian illustration in the style of Sadamoto, featuring a cute BLUE round-faced character, with blue skin, in [avatar outfit], [avatar actions], with [avatar expression] in [avatar posture]. The dystopian and surreal background showcases [avatar scene and environment] with cell shading, grainy textures, and vintage aesthetics. A a "[literal_username]" banner enhance the mysterious ambiance.',
	},
	{
		name: 'minimalist pixel art',
		keyword: 'minimalistpixel',
		value:
			'Minimalist pixel art scene featuring a simplified BLUE round-faced character, with blue skin, dressed in [avatar outfit], [avatar actions], with [avatar expression] in [avatar posture]. The clean, geometric background depicts [avatar scene and environment], with a a "[literal_username]" banner rendered using a limited color palette and minimalistic, abstract shapes.',
	},
	{
		name: 'pixel art portrait',
		keyword: 'pixelportrait',
		value:
			'Pixel art portrait focusing on a BLUE round-faced character, with blue skin, wearing [avatar outfit], [avatar actions], displaying [avatar expression] in [avatar posture]. The detailed, close-up background showcases [avatar scene and environment], with a a "[literal_username]" banner rendered in a high-resolution, realistic pixel art style.',
	},
	{
		name: 'sketch art',
		keyword: 'sketch',
		value:
			'Detailed sketch art illustration featuring a cute BLUE round-faced character, with blue skin, in [avatar outfit], [avatar actions], with [avatar expression] in [avatar posture]. The sketchy background depicts [avatar scene and environment], with a a "[literal_username]" banner sketched in loose, expressive lines.',
	},
	{
		name: 'fauvism art',
		keyword: 'fauvism',
		value:
			'Fauvism-inspired painting of a vibrant BLUE round-faced character, with blue skin, in [avatar outfit], [avatar actions], with [avatar expression] in [avatar posture]. The bold, colorful background showcases [avatar scene and environment], with a a "[literal_username]" banner rendered in vivid, expressive brushstrokes.',
	},
];

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
		fs.appendFile(logFilePath, `[${now}] ${args.join(' ')}\n`).then(() => {
			originalLog(`[${now}]`, ...args);
		});
	};

	await Promise.all([
		ensureFileExists(tokenFilePath),
		ensureFileExists(imagesFilePath, JSON.stringify({})),
		ensureFileExists(ignoreFilePath, JSON.stringify([])),
		ensureFileExists(meaningsFilePath, JSON.stringify({})),
		ensureFileExists(themeFilePath, JSON.stringify({})),
		ignoreListManager.loadIgnoreList(),
	]);

	await loadThemes(themeFilePath);
	await loadMeanings(meaningsFilePath);

	console.log(`Using token file: ${tokenFilePath}`);
	console.log(`Using images file: ${imagesFilePath}`);
	console.log(`Using meanings file: ${meaningsFilePath}`);
	console.log(`Using themes file: ${themeFilePath}`);
	console.log(`Using ignore file: ${ignoreFilePath}`);

	await main();
} catch (error: unknown) {
	if (error instanceof Error) {
		console.error(error.message);
	}
}
