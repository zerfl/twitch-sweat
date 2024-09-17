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
import { ImageGeneratorFactory, ImageGeneratorType } from './utils/ImageGeneratorFactory';
import { z } from 'zod';

const requiredEnvVars = [
	'TWITCH_CLIENT_ID',
	'TWITCH_CLIENT_SECRET',
	'TWITCH_CHANNELS',
	'TWITCH_ACCESS_TOKEN',
	'TWITCH_REFRESH_TOKEN',
	'OPENAI_IMAGES_PER_MINUTE',
	'OPENAI_MODEL',
	'DISCORD_BOT_TOKEN',
	'DISCORD_CHANNELS',
	'DISCORD_ADMIN_USER_ID',
	'MAX_RETRIES',
	'CLOUDFLARE_ACCOUNT_ID',
	'CLOUDFLARE_API_TOKEN',
	'CLOUDFLARE_IMAGES_URL',
	'CLOUDFLARE_AI_GATEWAY',
	'IMAGE_GENERATOR_TYPE',
	'IMAGE_GENERATOR_SAFETY_CHECKER',
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

type ImageUploadResult = {
	success: boolean;
	message: string;
};

type UserMeaningMap = Map<string, string>;
type BroadcasterThemeMap = Map<string, string>;

const UsernameInterpretation = z.object({
	interpretation: z.string(),
	themes: z.array(z.string()),
	avatar: z.object({
		description: z.string(),
		facial_expression: z.string(),
		posture: z.string(),
		outfit: z.string(),
		accessories: z.array(z.string()),
		quote: z.string(),
	}),
	scene: z.object({
		background: z.string(),
		banner: z.string(),
	}),
});

const imageGeneratorType = process.env.IMAGE_GENERATOR_TYPE as ImageGeneratorType;
const enableSafetyChecker = process.env.IMAGE_GENERATOR_SAFETY_CHECKER === 'true';
const imageGenerator = ImageGeneratorFactory.createGenerator(imageGeneratorType);

const isAdminOrBroadcaster = (userDisplayName: string, broadcasterName: string): boolean => {
	const lowerUserName = userDisplayName.toLowerCase();
	const lowerBroadcasterName = broadcasterName.toLowerCase();
	const adminList = [...Array.from(twitchAdmins), lowerBroadcasterName];
	return adminList.includes(lowerUserName);
};

const getRandomTemplate = (templates: DalleTemplate[]): DalleTemplate => {
	return templates[Math.floor(Math.random() * templates.length)];
};

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

async function generatePrompt(
	username: string,
	theme: string,
	style: string | null = null,
): Promise<{ analysis: string; revisedPrompt: string }> {
	const userMeaning = getUserMeaning(username.toLowerCase());
	const queryMessage =
		userMeaning !== username
			? `Literal username: ${username}\nIntended meaning: ${userMeaning}`
			: `Username: ${username}`;

	const template = style
		? dalleTemplates.find((t) => t.keyword.toLowerCase() === style.toLowerCase()) ?? getRandomTemplate(dalleTemplates)
		: getRandomTemplate(dalleTemplates);

	console.log(`Using template: ${template.name}`);

	let queryAnalyzerPrompt = analyzerPrompt.replace('__DATE__', new Date().toISOString().slice(0, 10));
	queryAnalyzerPrompt = queryAnalyzerPrompt.replace('__STYLE_NAME__', template.name);

	const analysisMessages: OpenAI.ChatCompletionMessageParam[] = [
		{
			role: 'system',
			content: queryAnalyzerPrompt,
		},
		{
			role: 'user',
			content: queryMessage,
		},
	];

	const analysisResult = await openaiThrottle(() => {
		console.log(`Analysing text: ${username} / ${userMeaning}`);
		return openAIManager.getChatCompletion(analysisMessages, {
			length: 500,
			schema: UsernameInterpretation,
			schemaName: 'usernameInterpretation',
		});
	});

	// TODO(daniel): Construct a proper prompt here.
	let analysis = `Interpretation: ${analysisResult.interpretation}
Themes: ${analysisResult.themes.join(', ')}
Avatar:
	- Description: ${analysisResult.avatar.description}
	- Facial expression: ${analysisResult.avatar.facial_expression}
	- Posture: ${analysisResult.avatar.posture}
	- Outfit: ${analysisResult.avatar.outfit}
	- Accessories: ${analysisResult.avatar.accessories.join(', ')}
	- Quote: ${analysisResult.avatar.quote}
Scene:
	- Background: ${analysisResult.scene.background}
	- Banner: ${analysisResult.scene.banner}`;

	// console.log(analysis);

	if (theme) {
		const themeMessages: OpenAI.ChatCompletionMessageParam[] = [
			{
				role: 'system',
				content: themePrompt.replace('__THEME__', theme).replace('__STYLE_NAME__', template.name),
			},
			{
				role: 'user',
				content: analysis,
			},
		];
		const themedAnalysis = await openaiThrottle(() => {
			console.log(`Adding theme: ${theme}`);
			return openAIManager.getChatCompletion(themeMessages, {
				length: 500,
				schema: UsernameInterpretation,
				schemaName: 'usernameInterpretation',
			});
		});

		// TODO(daniel): Construct a proper prompt here.
		analysis = `Interpretation: ${themedAnalysis.interpretation}
Themes: ${themedAnalysis.themes.join(', ')}
Avatar:
	- Description: ${themedAnalysis.avatar.description}
	- Facial expression: ${themedAnalysis.avatar.facial_expression}
	- Posture: ${themedAnalysis.avatar.posture}
	- Outfit: ${themedAnalysis.avatar.outfit}
	- Accessories: ${themedAnalysis.avatar.accessories.join(', ')}
	- Quote: ${themedAnalysis.avatar.quote}
Scene:
	- Background: ${themedAnalysis.scene.background}
	- Banner: ${themedAnalysis.scene.banner}`;

		console.log(`New analysis: ${analysis}`);
	}

	analysis = `Literal username: ${username}\n${analysis}`;

	const queryScenarioPrompt = scenarioPrompt
		.replace('__STYLE_NAME__', template.name)
		.replace('__STYLE_TEMPLATE__', template.value);

	console.log(`Analysed text: ${analysis}`);

	const revisedPrompt = await openaiThrottle(() => {
		const generatePromptMessages: OpenAI.ChatCompletionMessageParam[] = [
			{
				role: 'system',
				content: queryScenarioPrompt,
			},
			{
				role: 'user',
				content: analysis,
			},
		];
		return openAIManager.getChatCompletion(generatePromptMessages, { length: 400 });
	});

	console.log(`Generated prompt: ${revisedPrompt}`);

	return { analysis: analysis, revisedPrompt };
}

async function generateImage(prompt: string): Promise<ImageGenerationResult> {
	const imagePromptSingleLine = prompt.replace(/\n/g, '');

	const imageResult = await dalleThrottle(() => {
		return imageGenerator.generateImage({
			prompt: imagePromptSingleLine,
			size: '1024x1024',
			numberOfImages: 1,
			enableSafetyChecker: enableSafetyChecker,
		});
	});

	if (!imageResult.success) {
		throw new Error(`Image generation failed: ${imageResult.message}`);
	}

	return {
		success: true,
		message: imageResult.message,
		analysis: imageResult.analysis || '',
		revisedPrompt: imageResult.revisedPrompt || '',
	};
}

async function uploadImage(imageUrl: string, metadata: Record<string, unknown> = {}): Promise<ImageUploadResult> {
	const uploadedImage = await cfUploader.uploadImageFromUrl(imageUrl, metadata);

	if (!uploadedImage.success) {
		console.log(`Image upload failed: ${uploadedImage.errors}`);
		console.log(uploadedImage.errors);
		return { success: false, message: 'Error' };
	}

	const finalUrl = `${process.env.CLOUDFLARE_IMAGES_URL}/${uploadedImage.result.id}.png`;
	console.log(`Image uploaded: ${finalUrl}`);

	return {
		success: true,
		message: finalUrl,
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
	style: string | null = null,
): Promise<void> {
	if (ignoreListManager.isUserIgnored(target.toLowerCase())) {
		console.log(`User ${target} is ignored, not generating image`);
		return;
	}
	const verb = gifting ? 'gifting' : 'subscribing';

	try {
		const metadata = { source: 'twitch', channel: broadcasterName, target: target, trigger: verb };
		const theme = getBroadcasterTheme(broadcasterName);

		const { analysis, revisedPrompt } = await retryAsyncOperation(generatePrompt, maxRetries, target, theme, style);
		const imageResult = await retryAsyncOperation(generateImage, maxRetries, revisedPrompt);

		if (!imageResult.success) {
			await messagesThrottle(() => {
				return twitchBot.say(
					broadcasterName,
					`Thank you @${target} for ${verb} dnkLove Unfortunately, I was unable to generate an image for you.`,
				);
			});
			return;
		}

		if (style) {
			Object.assign(metadata, { style: style });
		}

		const uploadResult = await retryAsyncOperation(uploadImage, maxRetries, imageResult.message, metadata);

		if (!uploadResult.success) {
			await messagesThrottle(() => {
				return twitchBot.say(
					broadcasterName,
					`Thank you @${target} for ${verb} dnkLove Unfortunately, I was unable to upload the image for you.`,
				);
			});
			return;
		}

		await storeImageData(broadcasterName, target, {
			image: uploadResult.message,
			analysis: analysis,
			revisedPrompt: revisedPrompt,
			date: new Date().toISOString(),
		});

		for (const channelId of discordChannels) {
			const channel = discordBot.channels.cache.get(channelId);
			if (channel && channel.isTextBased()) {
				try {
					await channel.send(`Thank you \`${target}\` for ${verb}. Here's your sweatling: ${uploadResult.message}`);
				} catch (error) {
					console.log(`Error sending message to channel ${channelId}`, error);
				}
			}
		}

		await messagesThrottle(() => {
			console.log(`Sending ${verb} image`);

			return twitchBot.say(
				broadcasterName,
				`Thank you @${target} for ${verb} dnkLove This is for you: ${uploadResult.message}`,
			);
		});
	} catch (error) {
		console.log('Error in handleEventAndSendImageMessage:', error);
		await messagesThrottle(() => {
			return twitchBot.say(
				broadcasterName,
				`Thank you @${target} for ${verb} dnkLove Unfortunately, an error occurred while generating an image for you.`,
			);
		});
	}
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
			channels: Array.from(twitchChannels),
			commands: [
				createBotCommand('aisweatling', async (params, { userDisplayName, broadcasterName, say }) => {
					if (!isAdminOrBroadcaster(userDisplayName, broadcasterName)) {
						return;
					}

					if (params.length === 0) return;

					const target = params[0].replace('@', '');
					if (ignoreListManager.isUserIgnored(target.toLowerCase())) {
						await messagesThrottle(() => {
							return say(`@${userDisplayName} ${target} does not partake in ai sweatlings.`);
						});
						return;
					}

					const specifiedStyle = params[1] ?? null;

					try {
						const metadata = {
							source: 'twitch',
							channel: broadcasterName,
							target: target,
							trigger: 'custom',
						};
						const theme = getBroadcasterTheme(broadcasterName);

						const { analysis, revisedPrompt } = await retryAsyncOperation(
							generatePrompt,
							maxRetries,
							target,
							theme,
							specifiedStyle,
						);
						const imageResult = await retryAsyncOperation(generateImage, maxRetries, revisedPrompt);

						if (!imageResult.success) {
							await messagesThrottle(() => {
								return say(truncate(`Sorry, @${userDisplayName}, I was unable to generate an image for you.`, 500));
							});
							return;
						}

						console.log(`Generated image: ${imageResult.message}, revised prompt: ${imageResult.revisedPrompt}`);

						const uploadResult = await retryAsyncOperation(uploadImage, maxRetries, imageResult.message, metadata);

						if (!uploadResult.success) {
							await messagesThrottle(() => {
								return twitchBot.say(
									broadcasterName,
									`Sorry @${userDisplayName}, I was unable to upload the image. @partyhorst FIX THIS!`,
								);
							});
							return;
						}

						await storeImageData(broadcasterName, params[0], {
							image: uploadResult.message,
							analysis: analysis,
							revisedPrompt: revisedPrompt,
							date: new Date().toISOString(),
						});

						for (const channelId of discordChannels) {
							const channel = discordBot.channels.cache.get(channelId);
							if (channel && channel.isTextBased()) {
								try {
									await channel.send(
										`@${userDisplayName} requested generation for \`${target}\`. Here's the sweatling: ${uploadResult.message}`,
									);
								} catch (error) {
									console.log(`Error sending message to channel ${channelId}`, error);
								}
							}
						}

						await messagesThrottle(() => {
							return say(`@${userDisplayName} Here's your image: ${uploadResult.message}`);
						});
					} catch (error) {
						await messagesThrottle(() => {
							return say(truncate(`Sorry, ${userDisplayName}, an error occurred while generating the image.`, 500));
						});
					}
				}),
				createBotCommand('customai', async (params, { userDisplayName, broadcasterName, say }) => {
					if (!isAdminOrBroadcaster(userDisplayName, broadcasterName)) {
						return;
					}

					if (params.length === 0) return;

					const customPrompt = params.join(' ');

					try {
						const imageResult = await retryAsyncOperation(generateImage, maxRetries, customPrompt);

						if (!imageResult.success) {
							await messagesThrottle(() => {
								return say(truncate(`Sorry, ${userDisplayName}, I was unable to generate an image for you.`, 500));
							});
							return;
						}

						console.log(`Generated image: ${imageResult.message}, revised prompt: ${imageResult.revisedPrompt}`);

						// const uploadResult = await retryAsyncOperation(uploadImage, maxRetries, imageResult.message, metadata);
						//
						// if (!uploadResult.success) {
						// 	await messagesThrottle(() => {
						// 		return twitchBot.say(
						// 			broadcasterName,
						// 			`Sorry @${userDisplayName}, I was unable to upload the image. @partyhorst FIX THIS!`,
						// 		);
						// 	});
						// 	return;
						// }

						await storeImageData(broadcasterName, 'custom', {
							image: imageResult.message,
							analysis: 'Custom prompt',
							revisedPrompt: customPrompt,
							date: new Date().toISOString(),
						});

						for (const channelId of discordChannels) {
							const channel = discordBot.channels.cache.get(channelId);
							if (channel && channel.isTextBased()) {
								try {
									await channel.send(
										`@${userDisplayName} requested generation. Here's the sweatling: ${imageResult.message}`,
									);
								} catch (error) {
									console.log(`Error sending message to channel ${channelId}`, error);
								}
							}
						}

						await messagesThrottle(() => {
							return say(`@${userDisplayName} Here's your image: ${imageResult.message}`);
						});
					} catch (error) {
						await messagesThrottle(() => {
							return say(truncate(`Sorry, ${userDisplayName}, an error occurred while generating the image.`, 500));
						});
					}
				}),
				createBotCommand('settheme', async (params, { userDisplayName, broadcasterName, say }) => {
					if (!isAdminOrBroadcaster(userDisplayName, broadcasterName)) {
						return;
					}

					if (params.length === 0) {
						await messagesThrottle(() => {
							return say(`@${userDisplayName} Please provide a theme.`);
						});
						return;
					}

					const theme = params.join(' ');
					await setTheme(broadcasterName.toLowerCase(), theme);
					await saveThemes(themeFilePath);

					await messagesThrottle(() => {
						return say(`@${userDisplayName} Theme set to: ${theme}`);
					});
				}),
				createBotCommand('deltheme', async (_params, { userDisplayName, broadcasterName, say }) => {
					if (!isAdminOrBroadcaster(userDisplayName, broadcasterName)) {
						return;
					}

					await removeTheme(broadcasterName.toLowerCase());
					await saveThemes(themeFilePath);

					await messagesThrottle(() => {
						return say(`@${userDisplayName} Theme removed.`);
					});
				}),
				createBotCommand('gettheme', async (_params, { userDisplayName, broadcasterName, say }) => {
					const theme = getBroadcasterTheme(broadcasterName.toLowerCase());
					await messagesThrottle(() => {
						if (!theme) {
							return say(`@${userDisplayName} No theme set.`);
						}

						return say(`@${userDisplayName} Current theme: ${theme}`);
					});
				}),
				createBotCommand('setmeaning', async (params, { userDisplayName, broadcasterName, say }) => {
					if (!isAdminOrBroadcaster(userDisplayName, broadcasterName)) {
						return;
					}

					if (params.length < 2) {
						await messagesThrottle(() => {
							return say(`@${userDisplayName} Please provide a username and a meaning.`);
						});
						return;
					}

					const user = params[0];
					const meaning = params.slice(1).join(' ');
					await setMeaning(user.toLowerCase(), meaning);
					await saveMeanings(meaningsFilePath);

					await messagesThrottle(() => {
						return say(`@${userDisplayName} Meaning for ${user} set.`);
					});
				}),
				createBotCommand('delmeaning', async (params, { userDisplayName, broadcasterName, say }) => {
					if (!isAdminOrBroadcaster(userDisplayName, broadcasterName)) {
						return;
					}

					if (params.length !== 1) {
						await messagesThrottle(() => {
							return say(`@${userDisplayName} Please provide a username.`);
						});
						return;
					}
					const user = params[0];
					const wasRemoved = await removeMeaning(user.toLowerCase());
					await saveMeanings(meaningsFilePath);

					await messagesThrottle(() => {
						if (!wasRemoved) {
							return say(`@${userDisplayName} Meaning for ${user} not found.`);
						}

						return say(`@${userDisplayName} Meaning for ${user} removed.`);
					});
				}),
				createBotCommand('getmeaning', async (params, { userDisplayName, say }) => {
					if (params.length !== 1) {
						await messagesThrottle(() => {
							return say(`@${userDisplayName} Please provide a username.`);
						});
						return;
					}

					const user = params[0];
					const meaning = getUserMeaning(user.toLowerCase());
					await messagesThrottle(() => {
						return say(`@${userDisplayName} ${user} means '${meaning}' dnkNoted`);
					});
				}),
				createBotCommand('noai', async (_params, { userDisplayName, say }) => {
					await ignoreListManager.addToIgnoreList(userDisplayName.toLowerCase());

					await messagesThrottle(() => {
						return say(`@${userDisplayName} You will no longer receive AI sweatlings`);
					});
				}),
				createBotCommand('yesai', async (_params, { userDisplayName, say }) => {
					await ignoreListManager.removeFromIgnoreList(userDisplayName.toLowerCase());

					await messagesThrottle(() => {
						return say(`@${userDisplayName} You will now receive AI sweatlings`);
					});
				}),
				createBotCommand('ping', async (_params, { userDisplayName, say }) => {
					if (userDisplayName.toLowerCase() !== 'partyhorst') return;

					await messagesThrottle(() => {
						return say(`@${userDisplayName} pong`);
					});
				}),
				createBotCommand('say', async (params, { say, userDisplayName }) => {
					if (userDisplayName.toLowerCase() !== 'partyhorst') return;
					if (params.length === 0) return;

					await messagesThrottle(() => {
						return say(params.join(' '));
					});
				}),
				createBotCommand('uguu', async (_params, { say, userDisplayName }) => {
					if (userDisplayName.toLowerCase() !== 'partyhorst') return;

					await messagesThrottle(() => {
						return say(`!uguu`);
					});
				}),
				createBotCommand('myai', async (_params, { userDisplayName, broadcasterName, say }) => {
					await messagesThrottle(() => {
						return say(
							`@${userDisplayName} You can browse your AI sweatlings in the discord or at https://www.curvyspiderwife.com/channel/${broadcasterName}/user/${userDisplayName} dnkLove`,
						);
					});
				}),
			],
		});

		twitchBot.onDisconnect((manually, reason) => {
			console.log(`[ERROR] Disconnected from Twitch: ${manually} ${reason}`);
		});
		twitchBot.onConnect(() => {
			console.log(`Connected to ${Array.from(twitchChannels).join(', ')}!`);
		});
		twitchBot.onSub(({ broadcasterName, userDisplayName }) => {
			console.log('onSub', broadcasterName, userDisplayName);
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, userDisplayName);
		});
		twitchBot.onResub(({ broadcasterName, userDisplayName }) => {
			console.log('onResub', broadcasterName, userDisplayName);
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, userDisplayName);
		});
		twitchBot.onGiftPaidUpgrade(({ broadcasterName, userDisplayName }) => {
			console.log('onGiftPaidUpgrade', broadcasterName, userDisplayName);
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, userDisplayName);
		});
		twitchBot.onPrimePaidUpgrade(({ broadcasterName, userDisplayName }) => {
			console.log('onPrimePaidUpgrade', broadcasterName, userDisplayName);
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, userDisplayName);
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
		twitchBot.onSubGift(({ broadcasterName, userDisplayName }) => {
			console.log('onSubGift', broadcasterName, userDisplayName);
			handleEventAndSendImageMessage(twitchBot, discordBot, broadcasterName, userDisplayName);
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

const openAIManager = new OpenAIManager(
	process.env.OPENAI_API_KEY!,
	process.env.OPENAI_MODEL!,
	process.env.CLOUDFLARE_AI_GATEWAY,
);
const cfUploader = new CloudflareUploader(process.env.CLOUDFLARE_ACCOUNT_ID!, process.env.CLOUDFLARE_API_TOKEN!);
const twitchChannels = new Set((process.env.TWITCH_CHANNELS ?? '').toLowerCase().split(',').filter(Boolean));
const twitchAdmins = new Set((process.env.TWITCH_ADMINS ?? '').toLowerCase().split(',').filter(Boolean));
const discordChannels = process.env.DISCORD_CHANNELS!.split(',');
const discordAdmin = process.env.DISCORD_ADMIN_USER_ID!;
const userMeaningMap: UserMeaningMap = new Map();
const broadcasterThemeMap: BroadcasterThemeMap = new Map();
const ignoreListManager = new IgnoreListManager(ignoreFilePath);
const messagesThrottle = throttledQueue(20, 30 * 1000, true);
const openaiThrottle = throttledQueue(1000, 60 * 1000, true);
const imagesPerMinute = parseInt(process.env.OPENAI_IMAGES_PER_MINUTE!, 10);
const maxRetries = parseInt(process.env.MAX_RETRIES!, 10);

type DalleTemplate = {
	name: string;
	keyword: string;
	value: string;
};

const analyzerPrompt = `Today is __DATE__.

You are an expert in interpreting usernames and creating avatar descriptions. I will provide you with a username, and I'd like you to answer the following questions:
   
1. Interpretation: What is the literal interpretation of this username? It may involve wordplay, puns, direct meanings, or cultural references.
2. Themes / Ideas: What themes or ideas does this username convey?
3. Description: How would you describe an avatar that represents this username?
3.1. Facial expression: What facial expression would best suit this avatar?
3.2. Posture: What posture or stance would best reflect the username's themes or ideas?
3.3. Outfit: What kind of outfit would directly connect to the username's key themes or ideas? Bias towards an orange hoodie unless another outfit more vividly reflects the username.
3.4. Accessories / Features: What unique accessories or features would enhance the avatar's connection to the username?
4. Scene / Background: What kind of scene or background would best complement this avatar? Consider the setting, mood, and overall atmosphere.
5. Banner: Incorporate the literal username into the scene in a creative and engaging way. The literal username MUST be included in quotes and the text must be visually appealing. Refer to the username to include as simply a text element in the scene.
6. Quote: Provide a short quote that the avatar might say, given the scene. Keep it concise and natural-sounding.

Guidelines:
- Create an engaging and immersive scene that resonates with the username's themes or ideas.
- Create a plot or narrative that involves this avatar.
- Imagine what the avatar might be doing or experiencing in the scene.
- Be brave, creative, provocative, literal, humorous and original in your interpretations. 
- Avoid mentioning ears, tails, or other animalistic features unless directly relevant to the username or its interpretation.
- Avoid mentioning hair or other physical attributes that are not explicitly part of the username or its interpretation.
- You may be edgy, explicit and daring in your interpretations. After all, this is a creative exercise.
- Use simple and direct language to convey your ideas, avoiding complex or convoluted sentences. Children should be able to understand your descriptions.

The created scene and avatar will be used in an art piece. The style of the art piece is __STYLE_NAME__ and therefore the avatar and information should be designed in a way that fits this style.

Start with the answers to the questions right away and skip any preamble. Avoid formatting and answer in plaintext.`;

const themePrompt = `You are a master of thematic adaptation, skilled in transforming avatar descriptions and scenes to fully embody specific themes. You will receive an interpretation of a username and a detailed avatar description. Your task is to boldly infuse these elements with a given theme, creating a vivid and immersive thematic experience.

Today's theme:
"""
__THEME__
"""

Guidelines:
1. Make the theme a central and unmistakable element of the adaptation.
2. Keep the original username AS-IS and unchanged.
3. Maintain the essence of the original username interpretation, but feel free to add thematic elements.
4. Adapt the avatar's descriptions to incorporate the theme, while preserving its core identity.
5. Transform the scene, background, and environment to fully embody the theme.
6. If the theme strongly contradicts the original interpretation, create a compelling narrative that bridges this gap.
7. Keep the original structure of the provided information intact, focusing on the theme's integration.

The created scene and avatar will be used in an art piece. The style of the art piece is __STYLE_NAME__ and therefore the avatar and information should be designed in a way that fits this style.

Be imaginative, detailed, and daring in your adaptations. Ensure the theme is prominently featured throughout your response.
Start with your response right away and skip any preamble. Avoid formatting and answer in plaintext.`;

const scenarioPrompt = `I'll provide a template enclosed in triple quotes. Populate the bracketed placeholders in the template with creative details derived from the provided information, using clear and direct language. Focus on key elements of the username and skip redundant phrases. Use precise and targeted language. Clearly convey the placement and role of specific objects in relation to the scene.

Replace the placeholders strictly with the relevant information, without introducing any additional formatting or making changes to the template's structure. If a placeholder doesn't have a direct correspondence with the provided information, use your best judgment to fill it in while staying true to the overall theme and style.

The rest of the template, including the original wording, base prompt, and the image style defined as __STYLE_NAME__, must remain unchanged.

Template: """__STYLE_TEMPLATE__"""

Instructions:
- Fill in each placeholder with clear, direct language that resonates with the overall theme and style indicated.
- Refer to the avatar as simply 'character'.
- Use very simple sentences and avoid convoluted or complex phrasing. It must be easy to understand.
- Only replace the text within the brackets []. Do not alter the template's wording or structure.
- Provide a response suitable for immediate use, reflecting the specified style and theme.
- Quotes may be placed around the literal username only.
- Avoid newlines. Keep the text in a single paragraph.
- Make sure the final text is concise and fits within 150 words.
- If the template contains a [quote] placeholder, AVOID a banner. Otherwise include a banner.

Provide only the processed text, skipping any preamble or explanations.`;

const dalleTemplates: DalleTemplate[] = [
	{
		name: 'illustration',
		keyword: 'illustration',
		value:
			'Illustration of a cute BLUE round-faced character, with blue skin. [banner]. [avatar outfit][avatar actions][avatar facial expression][avatar posture][avatar physique]. The scene is set in [avatar scene and environment, including feeling and mood].',
	},
	{
		name: 'watercolor painting',
		keyword: 'watercolor',
		value:
			'Watercolor painting of a cute BLUE round-faced character, with blue skin. [banner]. [avatar outfit][avatar actions][avatar facial expression][avatar posture][avatar physique]. The soft, fluid background depicts [avatar scene and environment, including feeling and mood].',
	},
	{
		name: 'pixel art',
		keyword: 'pixel',
		value:
			'16 bit blocky and crisp pixel art featuring a cute BLUE round-faced character, with blue skin. [avatar outfit][avatar actions][avatar facial expression][avatar posture][avatar physique] The [avatar scene and environment, including feeling and mood]. [banner]',
	},
	{
		name: 'oil painting',
		keyword: 'oil',
		value:
			'Oil painting of a cute BLUE round-faced character, with blue skin. [banner]. [avatar outfit][avatar actions][avatar facial expression][avatar posture][avatar physique]. The rich and textured background depicts [avatar scene and environment, including feeling and mood].',
	},
	{
		name: 'flat illustration',
		keyword: 'flat',
		value:
			'Flat design illustration of a cute BLUE round-faced character, with blue skin. [banner]. [avatar outfit][avatar actions][avatar facial expression][avatar posture][avatar physique]. The simplistic background features bold colors and [avatar scene and environment, including feeling and mood].',
	},
	{
		name: 'glitch art illustration',
		keyword: 'glitch',
		value:
			'Glitch art illustration featuring a cute BLUE round-faced character, with blue skin. [banner]. [avatar outfit][avatar actions][avatar facial expression][avatar posture][avatar physique]. The backdrop showcases [avatar scene and environment, including feeling and mood] with vibrant glitches.',
	},
	{
		name: 'Byzantine art illustration',
		keyword: 'byzantine',
		value:
			'Byzantine-inspired illustration of a cute BLUE round-faced character, with blue skin. [banner]. [avatar outfit][avatar actions][avatar facial expression][avatar posture][avatar physique]. The golden, vibrant background depicts [avatar scene and environment, including feeling and mood].',
	},
	{
		name: 'expressionism drawing',
		keyword: 'expressionism',
		value:
			'Expressionist drawing of a cute BLUE round-faced character, with blue skin. [banner]. [avatar outfit][avatar actions][avatar facial expression][avatar posture][avatar physique]. The background features [avatar scene and environment, including feeling and mood].',
	},
	{
		name: 'charcoal drawing',
		keyword: 'charcoal',
		value:
			'Charcoal drawing of a cute BLUE round-faced character, with blue skin. [banner]. [avatar outfit][avatar actions][avatar facial expression][avatar posture][avatar physique]. The background depicts [avatar scene and environment, including feeling and mood].',
	},
	{
		name: 'neon graffiti illustration',
		keyword: 'neon',
		value:
			'Illustration of a neon graffiti scene featuring a cute BLUE round-faced character, with blue skin. [banner]. [avatar outfit][avatar actions][avatar facial expression][avatar posture][avatar physique]. The backdrop showcases [avatar scene and environment, including feeling and mood].',
	},
	{
		name: 'vintage manga illustration',
		keyword: 'vintagemanga',
		value:
			'1980s vintage manga still frame depicting a cute BLUE round-faced character, with blue skin. [banner]. [avatar outfit][avatar actions][avatar facial expression][avatar posture][avatar physique]. The backdrop features [avatar scene and environment, including feeling and mood] with cell shading, capturing a grainy and vintage look with overlapping visual channels.',
	},
	{
		name: 'Rumiko Takahashi illustration',
		keyword: 'takahashi',
		value:
			'Illustration reminiscent of exaggeration, bold lines, and vivid colors featuring a cute BLUE round-faced character, with blue skin. [banner]. [avatar outfit][avatar actions][avatar facial expression][avatar posture][avatar physique]. The grainy, surreal background depicts [avatar scene and environment, including feeling and mood] with vintage anime elements.',
	},
	{
		name: 'Yoshiyuki Sadamoto illustration',
		keyword: 'sadamoto',
		value:
			'Dystopian and mysterious illustration, featuring a cute BLUE round-faced character, with blue skin. [banner]. [avatar outfit][avatar actions][avatar facial expression][avatar posture][avatar physique]. The dystopian and surreal background showcases [avatar scene and environment, including feeling and mood] with grainy textures and vintage aesthetics.',
	},
	{
		name: 'minimalist pixel art',
		keyword: 'minimalistpixel',
		value:
			'Minimalist pixel art scene featuring a simplified cute BLUE round-faced character, with blue skin. [banner]. [avatar outfit][avatar actions][avatar facial expression][avatar posture]. [avatar physique]. The clean, geometric background depicts [avatar scene and environment, including feeling and mood].',
	},
	{
		name: 'pixel portrait art',
		keyword: 'pixelportrait',
		value:
			'Pixel art portrait focusing on a cute BLUE round-faced character, with blue skin. [banner]. [avatar outfit][avatar actions][avatar facial expression][avatar posture][avatar physique]. The detailed, close-up background showcases [avatar scene and environment, including feeling and mood].',
	},
	{
		name: 'sketch art',
		keyword: 'sketch',
		value:
			'A detailed sketch featuring a cute BLUE round-faced character, with blue skin. [banner]. [avatar outfit][avatar actions][avatar facial expression][avatar posture][avatar physique]. The sketchy background depicts [avatar scene and environment, including feeling and mood].',
	},
	{
		name: 'fauvism art',
		keyword: 'fauvism',
		value:
			'A fauvism-inspired painting of a vibrant cute BLUE round-faced character, with blue skin. [banner]. [avatar outfit][avatar actions][avatar facial expression][avatar posture][avatar physique]. The bold, colorful background showcases [avatar scene and environment, including feeling and mood].',
	},
	{
		name: 'anime illustration',
		keyword: 'anime',
		value:
			'Screenshot of a 90s anime episode depicting a CUTE BLUE-SKINNED round-faced character, the subtitles say "[quote]". The character wears [avatar outfit]. [banner]. [avatar facial, avatar expression, avatar posture, avatar physique, avatar actions, scene].',
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
	console.log(`Using OpenAI model: ${process.env.OPENAI_MODEL}`);
	console.log('Twitch admins:', Array.from(twitchAdmins).join(', '));

	await main();
} catch (error: unknown) {
	if (error instanceof Error) {
		console.error(error.message);
	}
}
