import 'dotenv/config';
import * as path from 'path';
import { PathLike, promises as fs } from 'fs';
import { env } from './env';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import { AccessToken, InvalidTokenError, RefreshingAuthProvider } from '@twurple/auth';
import { Bot, createBotCommand } from '@twurple/easy-bot';
import { ActivityType, Client as DiscordClient, Events, GatewayIntentBits, Partials, TextChannel } from 'discord.js';
import throttledQueue from 'throttled-queue';
import { IgnoreListManager } from './utils/IgnoreListManager';
import { CloudflareUploader } from './utils/CloudflareUploader';
import { OpenAIManager } from './utils/OpenAIManager';
import { nanoid } from 'nanoid';
import { z } from 'zod';

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

interface EventData {
	broadcasterName: string;
	userName: string;
	userDisplayName: string;
	isGifting?: boolean;
}

type UserMeaningMap = Map<string, string>;
type BroadcasterThemeMap = Map<string, string>;
type BroadcasterBannedGiftersMap = Map<string, string[]>;

const analysisSchema = z.object({
	reasoning: z.object({
		reasoning_steps: z.array(z.string()).describe('The reasoning steps leading to the final conclusion.'),
		answer: z.string().describe('The final answer, taking into account the reasoning steps.'),
	}),
	interpretation: z.string().describe('The final interpretation of the user input.'),
});

const testGenerationState = {
	isRunning: false,
	shouldCancel: false,
};

const sceneSchema = z.object({
	interpretation: z.object({
		literal: z.string(),
		themes_ideas: z.array(z.string()),
	}),
	subject: z.object({
		facial_expression: z.string(),
		posture: z.string(),
		clothes: z.object({
			type: z.string(),
			attributes: z.array(z.string()),
		}),
		accessories: z.array(z.string()),
		looks: z.string(),
	}),
	lighting: z.object({
		type: z.string(),
		attributes: z.array(z.string()),
	}),
	objects: z.object({
		banner: z
			.object({
				content: z.string(),
				style: z.string(),
				mood: z.string(),
			})
			.describe('A way to show the literal username in the scene'),
		additional_objects: z
			.array(
				z.object({
					name: z.string(),
					type: z.string(),
					position: z.string(),
					attributes: z.array(z.string()),
				}),
			)
			.describe('Objects in the scene that are relevant to the user or action to spice up the scene'),
	}),
	scene: z.object({
		setting: z.string(),
		mood: z.string(),
		atmosphere: z.string(),
		background: z.string(),
		narrative: z.object({
			plot: z.string(),
			subject_action: z
				.string()
				.describe('The action the avatar is performing. Must be relevant to the scene and expressive.'),
		}),
	}),
});

const finalSchema = z.object({
	step1: analysisSchema.describe('The analysis of the user input.'),
	step2: sceneSchema.describe('The avatar and scene generated based on the analysis.'),
});

const isAdminOrBroadcaster = (userName: string, broadcasterName: string): boolean => {
	const lowerUserName = userName.toLowerCase();
	const lowerBroadcasterName = broadcasterName.toLowerCase();
	const adminList = [...Array.from(twitchAdmins), lowerBroadcasterName];
	return adminList.includes(lowerUserName);
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

async function generateImage(
	username: string,
	userDisplayName: string,
	metadata: Record<string, unknown> = {},
	theme: string,
	style: string | null = null,
): Promise<ImageGenerationResult> {
	const uniqueId = nanoid(14);

	let template: DalleTemplate | undefined;
	if (style) {
		template = dalleTemplates.find((t) => t.keyword.toLowerCase() === style!.toLowerCase());
	}
	if (!template) {
		const templateIndex = Math.floor(Math.random() * dalleTemplates.length);
		template = dalleTemplates[templateIndex] as DalleTemplate;
		style = template.keyword.toLowerCase();
	}

	const userMeaning = getUserMeaning(username.toLowerCase());
	const queryMessage =
		userMeaning !== username
			? `Literal username: ${userDisplayName}\nIntended meaning: ${userMeaning}`
			: `Username: ${userDisplayName}`;

	console.log(`[${uniqueId}]`, userMeaning, `Using template: ${template.name}`);

	// Now do another request but using structured output from OpenAI
	const structuredAnalysisMessages: OpenAI.ChatCompletionMessageParam[] = [
		{
			role: 'system',
			content: structuredOutputPrompt
				.replace('__DATE__', new Date().toISOString().slice(0, 10))
				.replace('__STYLE_NAME__', template.name),
		},
		{
			role: 'user',
			content: queryMessage,
		},
	];

	let structuredOutput = await openaiThrottle(() => {
		console.log(`[${uniqueId}]`, userMeaning, `Requesting structured output`);
		return openAIManager.getChatCompletion(structuredAnalysisMessages, {
			length: 1000,
			schema: finalSchema,
			schemaName: 'finalSchema',
		});
	});

	if (theme) {
		const themeMessages: OpenAI.ChatCompletionMessageParam[] = [
			{
				role: 'system',
				content: themePrompt.replace('__THEME__', theme),
			},
			{
				role: 'user',
				content: JSON.stringify(structuredOutput),
			},
		];
		structuredOutput = await openaiThrottle(() => {
			console.log(`[${uniqueId}]`, userMeaning, `Adding theme: ${theme}`);
			return openAIManager.getChatCompletion(themeMessages, {
				length: 1000,
				schema: finalSchema,
				schemaName: 'finalSchema',
			});
		});

		console.log(`[${uniqueId}]`, userMeaning, `New analysis:`, structuredOutput);
	}

	const analysisResult = `Literal username: ${userDisplayName}\n${structuredOutput}`;

	Object.assign(structuredOutput.step2, { style: template.description });
	Object.assign(structuredOutput.step2, { style_description: template.name });

	const imagePrompt = JSON.stringify(structuredOutput.step2);

	const image = await dalleThrottle(() => {
		console.log(`[${uniqueId}]`, userMeaning, `Creating image.`);
		return openAIManager.generateImage({
			model: 'dall-e-3',
			prompt: `Your task is to create concise and focused image generation prompt using the provided structured data.
			
Create a prompt using the following rules:

Start with the specific art medium/style from the JSON data. Use the EXACT STYLE provided and phrase the beginning NATURALLY to match it. For example:
- For watercolor: "A watercolor painting of..."
- For pixel art: "16-bit pixel art of..."
- For charcoal: "A charcoal drawing of..."

These are just examples. ALWAYS begin with the style specified in the JSON.

[IMPORTANT RULES]
1. Use the phrase "a cute BLUE round-faced avatar with blue skin" EXACTLY as written. DO NOT MODIFY IT.
2. Follow IMMEDIATELY with the banner featuring the username.
3. Build the rest of the scene CREATIVELY, ensuring EVERY ELEMENT aligns with the STYLE and CONTEXT from the JSON. DO NOT ADD ANYTHING beyond what the JSON provides.
4. Reinforce the chosen style's NATURAL ARTISTIC QUALITIES by HIGHLIGHTING textures, techniques, or visual features TYPICAL of the style (e.g., "soft, blended strokes" for watercolor, "bold shapes" for pixel art). If NO specific description is provided, INFER COMMON PROPERTIES of the style.
5. IMPORTANT: Generate a CONCISE prompt. Be brief and to the point. Focus on key elements only, removing unnecessary details while preserving the core concept and style.
6. The phrase "a cute BLUE round-faced avatar with blue skin" MUST be USED VERBATIM in the prompt, even if it seems redundant. Even in concise prompts, this phrase MUST be included.

[NOTES]
- The ENTIRE PROMPT must be based SOLELY on the JSON input. DO NOT INVENT or add elements that AREN'T explicitly provided or implied.
- AVOID abstract descriptors ("dream-like"), VAGUE TERMS ("digital art"), and HUMAN-LIKE features like ears or tails.

Data:
${imagePrompt}`,
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

	const finalUrl = `${env.CLOUDFLARE_IMAGES_URL}/${uploadedImage.result.id}.png`;
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
	eventData: EventData,
): Promise<void> {
	const { broadcasterName, userName, userDisplayName, isGifting = false } = eventData;

	if (ignoreListManager.isUserIgnored(userName.toLowerCase())) {
		console.log(`User ${userName} is ignored, not generating image`);
		return;
	}
	const verb = isGifting ? 'gifting' : 'subscribing';

	let imageResult: ImageGenerationResult;
	try {
		const metadata = { source: 'twitch', channel: broadcasterName, target: userName, trigger: verb };
		const theme = getBroadcasterTheme(broadcasterName);
		imageResult = await retryAsyncOperation(generateImage, maxRetries, userName, userDisplayName, metadata, theme);
	} catch (error) {
		imageResult = { success: false, message: 'Error' };
	}

	if (!imageResult.success) {
		await messagesThrottle(() => {
			return twitchBot.say(
				broadcasterName,
				`Thank you @${userName} for ${verb} dnkLove Unfortunately, I was unable to generate an image for you.`,
			);
		});
		return;
	}

	await storeImageData(broadcasterName, userName, {
		image: imageResult.message,
		analysis: imageResult.analysis,
		revisedPrompt: imageResult.revisedPrompt,
		date: new Date().toISOString(),
	});

	for (const channelId of discordChannels) {
		const channel = discordBot.channels.cache.get(channelId);
		if (channel && channel.isTextBased() && channel.isSendable()) {
			try {
				// await channel.send(`Thank you \`${userName}\` for ${verb}. Here's your sweatling: ${imageResult.message}`);

				// const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
				// 	new ButtonBuilder().setCustomId('primary').setLabel('Click Me!').setStyle(ButtonStyle.Primary),
				// 	new ButtonBuilder().setLabel('Visit Website').setStyle(ButtonStyle.Link).setURL('https://discord.js.org/'),
				// );

				await channel.send({
					content: `Thank you \`${userName}\` for ${verb}. Here's your sweatling: ${imageResult.message}`,
					// components: [row],
				});
			} catch (error) {
				console.log(`Error sending message to channel ${channelId}`, error);
			}
		}
	}

	await messagesThrottle(() => {
		console.log(`Sending ${verb} image`);

		return twitchBot.say(
			broadcasterName,
			`Thank you @${userName} for ${verb} dnkLove This is for you: ${imageResult.message}`,
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

async function loadBannedGifters(filePath: PathLike): Promise<void> {
	try {
		const data = await fs.readFile(filePath, 'utf-8');
		const bannedGiftersData = JSON.parse(data) as Record<string, string[]>;
		for (const [broadcaster, bannedGifters] of Object.entries(bannedGiftersData)) {
			broadcasterBannedGiftersMap.set(
				broadcaster.toLowerCase(),
				bannedGifters.map((gifter) => gifter.toLowerCase()),
			);
		}
	} catch (error) {
		console.error(`Error reading banned gifters file at ${filePath}`, error);
	}
}

async function addBannedGifter(broadcaster: string, gifter: string): Promise<void> {
	const lowerBroadcaster = broadcaster.toLowerCase();
	const lowerGifter = gifter.toLowerCase();
	const bannedGifters: string[] = broadcasterBannedGiftersMap.get(lowerBroadcaster) || [];
	if (!bannedGifters.includes(lowerGifter)) {
		bannedGifters.push(lowerGifter);
		broadcasterBannedGiftersMap.set(lowerBroadcaster, bannedGifters);
	}
}

async function removeBannedGifter(broadcaster: string, gifter: string): Promise<boolean> {
	const lowerBroadcaster = broadcaster.toLowerCase();
	const lowerGifter = gifter.toLowerCase();
	const bannedGifters: string[] = broadcasterBannedGiftersMap.get(lowerBroadcaster) || [];
	const index = bannedGifters.indexOf(lowerGifter);
	if (index > -1) {
		bannedGifters.splice(index, 1);
		broadcasterBannedGiftersMap.set(lowerBroadcaster, bannedGifters);
		return true;
	}
	return false;
}

async function saveBannedGifters(filePath: PathLike): Promise<void> {
	const bannedGiftersData = Object.fromEntries(broadcasterBannedGiftersMap);
	await fs.writeFile(filePath, JSON.stringify(bannedGiftersData, null, 4), 'utf-8');
}

function isGifterBanned(broadcaster: string, gifter: string): boolean {
	const bannedGifters = broadcasterBannedGiftersMap.get(broadcaster.toLowerCase()) || [];
	return bannedGifters.includes(gifter.toLowerCase());
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

		discordBot.on(Events.InteractionCreate, async (interaction) => {
			if (!interaction.isButton()) return;
			if (interaction.customId === 'primary') {
				await interaction.reply(`Button clicked: ${interaction.user.displayName}`);
			}
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
					if (channel && channel.isTextBased() && channel.isSendable()) {
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
					const imageResult = await retryAsyncOperation(
						generateImage,
						maxRetries,
						param.toLowerCase(),
						param,
						metadata,
						theme,
					);
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
						if (channel && channel.isTextBased() && channel.isSendable()) {
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

		discordBot.login(env.DISCORD_BOT_TOKEN).catch((error) => {
			console.log('Discord bot login failed', error);
		});

		let tokenData: AccessToken = {
			accessToken: env.TWITCH_ACCESS_TOKEN,
			refreshToken: env.TWITCH_REFRESH_TOKEN,
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
			clientId: env.TWITCH_CLIENT_ID,
			clientSecret: env.TWITCH_CLIENT_SECRET,
		});

		authProvider.onRefresh(async (_userId, newTokenData) => {
			await fs.writeFile(tokenFilePath, JSON.stringify(newTokenData, null, 4), 'utf-8');
			tokenData = newTokenData;
		});
		authProvider.onRefreshFailure((error) => {
			console.log('Error refreshing token', error);
		});

		await authProvider.addUserForToken(tokenData, ['chat']);

		const commands = [
			createBotCommand('aisweatling', async (params, { userName, broadcasterName, say }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName)) {
					return;
				}

				if (params.length === 0) return;

				const target = params[0].replace('@', '');
				if (ignoreListManager.isUserIgnored(target.toLowerCase())) {
					await messagesThrottle(() => {
						return say(`@${userName} ${target} does not partake in ai sweatlings.`);
					});
					return;
				}

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
					imageResult = await retryAsyncOperation(
						generateImage,
						maxRetries,
						target.toLowerCase(),
						target,
						metadata,
						theme,
						specifiedStyle,
					);
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
					if (channel && channel.isTextBased() && channel.isSendable()) {
						try {
							// const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
							// 	new ButtonBuilder().setCustomId('primary').setLabel('Click Me!').setStyle(ButtonStyle.Primary),
							// 	new ButtonBuilder()
							// 		.setLabel('Visit Website')
							// 		.setStyle(ButtonStyle.Link)
							// 		.setURL('https://discord.js.org/'),
							// );

							await channel.send({
								content: `@${userName} requested generation for \`${target}\`. Here's the sweatling: ${imageResult.message}`,
								// components: [row],
							});
						} catch (error) {
							console.log(`Error sending message to channel ${channelId}`, error);
						}
					}
				}

				await messagesThrottle(() => {
					return say(`@${userName} requested generation for @${target}. Here's the sweatling: ${imageResult.message}`);
				});
			}),
			createBotCommand('settheme', async (params, { userName, broadcasterName, say }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName)) {
					return;
				}

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
				if (!isAdminOrBroadcaster(userName, broadcasterName)) {
					return;
				}

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
				if (!isAdminOrBroadcaster(userName, broadcasterName)) {
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
				if (!isAdminOrBroadcaster(userName, broadcasterName)) {
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
			createBotCommand('bangifter', async (params, { userName, broadcasterName, say }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName)) {
					return;
				}

				if (params.length !== 1) {
					await messagesThrottle(() => {
						return say(`@${userName} Please provide a username.`);
					});
					return;
				}

				const gifter = params[0];
				await addBannedGifter(broadcasterName, gifter);
				await saveBannedGifters(bannedGiftersFilePath);

				await messagesThrottle(() => {
					return say(`@${userName} Gifter ${gifter} banned. Sub gifts from this user will be ignored.`);
				});
			}),
			createBotCommand('unbangifter', async (params, { userName, broadcasterName, say }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName)) {
					return;
				}

				if (params.length !== 1) {
					await messagesThrottle(() => {
						return say(`@${userName} Please provide a username.`);
					});
					return;
				}

				const gifter = params[0];
				const wasRemoved = await removeBannedGifter(broadcasterName, gifter);
				await saveBannedGifters(bannedGiftersFilePath);

				await messagesThrottle(() => {
					if (wasRemoved) {
						return say(`@${userName} Gifter ${gifter} unbanned.`);
					}
				});
			}),
			createBotCommand('ping', async (_params, { userName, say }) => {
				if (userName.toLowerCase() !== 'partyhorst') return;

				await messagesThrottle(() => {
					return say(`@${userName} pong`);
				});
			}),
			createBotCommand('say', async (params, { say, userName, broadcasterName }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName)) {
					return;
				}
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
			createBotCommand('myai', async (_params, { userName, broadcasterName, say }) => {
				await messagesThrottle(() => {
					return say(
						`@${userName} You can browse your AI sweatlings in the discord or at https://www.curvyspiderwife.com/channel/${broadcasterName}/user/${userName} dnkLove`,
					);
				});
			}),
			createBotCommand('testall', async (params, { userName, broadcasterName, say }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName)) {
					return;
				}

				if (testGenerationState.isRunning) {
					await messagesThrottle(() => {
						return say(`@${userName} A test generation is already running. Use !canceltests to stop it.`);
					});
					return;
				}

				if (params.length === 0) {
					await messagesThrottle(() => {
						return say(`@${userName} Please provide a username to test with.`);
					});
					return;
				}

				const target = params[0].replace('@', '');
				const count = params[1] ? parseInt(params[1], 10) : 1;

				if (isNaN(count) || count < 1) {
					await messagesThrottle(() => {
						return say(`@${userName} Please provide a valid number of images to generate.`);
					});
					return;
				}

				const startTime = Date.now();
				testGenerationState.isRunning = true;
				testGenerationState.shouldCancel = false;

				const totalTasks = count * dalleTemplates.length;
				await messagesThrottle(() => {
					return say(
						`@${userName} Starting test generation for ${target} with ${count} image(s) per style. Total images: ${totalTasks}`,
					);
				});

				let successCount = 0;
				let failureCount = 0;
				const theme = getBroadcasterTheme(broadcasterName);

				const generationTasks = [];
				for (const template of dalleTemplates) {
					for (let i = 0; i < count; i++) {
						if (testGenerationState.shouldCancel) {
							break;
						}

						const task = async () => {
							if (testGenerationState.shouldCancel) {
								console.log(`Skipping generation for ${template.keyword} (cancelled)`);
								return;
							}

							try {
								const metadata = {
									source: 'twitch',
									channel: broadcasterName,
									target: target,
									trigger: 'test',
									style: template.keyword,
								};

								if (testGenerationState.shouldCancel) {
									console.log(`Skipping DALL-E generation for ${template.keyword} (cancelled)`);
									return;
								}

								const imageResult = await retryAsyncOperation(
									generateImage,
									maxRetries,
									target.toLowerCase(),
									target,
									metadata,
									theme,
									template.keyword,
								);

								if (!imageResult.success) {
									failureCount++;
									await messagesThrottle(() => {
										return say(`@${userName} Failed to generate image for style ${template.keyword}`);
									});
									return;
								}

								successCount++;
								await storeImageData(broadcasterName, target, {
									image: imageResult.message,
									analysis: imageResult.analysis,
									revisedPrompt: imageResult.revisedPrompt,
									date: new Date().toISOString(),
								});

								// Send to both Twitch and Discord
								await Promise.all([
									messagesThrottle(() => {
										return say(`@${userName} Test image for style ${template.keyword}: ${imageResult.message}`);
									}),
									...discordChannels.map((channelId) => {
										const channel = discordBot.channels.cache.get(channelId);
										if (channel?.isTextBased() && channel.isSendable()) {
											return channel.send({
												content: `Test image for \`${target}\` using style ${template.keyword}: ${imageResult.message}`,
											});
										}
										return Promise.resolve();
									}),
								]);
							} catch (error) {
								failureCount++;
								console.error(`Error generating test image for ${target} with style ${template.keyword}:`, error);
								await messagesThrottle(() => {
									return say(`@${userName} Error generating image for style ${template.keyword}`);
								});
							}
						};

						generationTasks.push(task);
					}
				}

				try {
					await Promise.all(generationTasks.map((task) => task()));
				} finally {
					testGenerationState.isRunning = false;
					const wasCancel = testGenerationState.shouldCancel;
					testGenerationState.shouldCancel = false;

					const endTime = Date.now();
					const totalSeconds = ((endTime - startTime) / 1000).toFixed(1);

					const summary =
						`Test generation ${wasCancel ? 'cancelled' : 'complete'}. ` +
						`Success: ${successCount}, Failures: ${failureCount}, ` +
						`Total: ${successCount + failureCount}/${totalTasks}. ` +
						`Time taken: ${totalSeconds}s`;

					await Promise.all([
						messagesThrottle(() => {
							return say(`@${userName} ${summary}`);
						}),
						...discordChannels.map((channelId) => {
							const channel = discordBot.channels.cache.get(channelId);
							if (channel?.isTextBased() && channel.isSendable()) {
								return channel.send({
									content: `${summary}`,
								});
							}
							return Promise.resolve();
						}),
					]);
				}
			}),
			createBotCommand('canceltests', async (params, { userName, broadcasterName, say }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName)) {
					return;
				}

				if (!testGenerationState.isRunning) {
					await messagesThrottle(() => {
						return say(`@${userName} No test generation is currently running.`);
					});
					return;
				}

				testGenerationState.shouldCancel = true;
				await messagesThrottle(() => {
					return say(`@${userName} Cancelling test generation after current tasks complete...`);
				});
			}),
		];

		const twitchBot = new Bot({
			authProvider,
			channels: Array.from(twitchChannels),
			commands: commands,
		});

		twitchBot.onDisconnect((manually, reason) => {
			console.log(`[ERROR] Disconnected from Twitch: ${manually} ${reason}`);
		});
		twitchBot.onConnect(() => {
			console.log(`Connected to chat server`);
		});
		twitchBot.onJoin(({ broadcasterName }) => {
			console.log(`Joined channel ${broadcasterName}`);
		});
		twitchBot.onSub(({ broadcasterName, userName, userDisplayName }) => {
			console.log('onSub', broadcasterName, userName, userDisplayName);
			handleEventAndSendImageMessage(twitchBot, discordBot, { broadcasterName, userName, userDisplayName });
		});
		twitchBot.onResub(({ broadcasterName, userName, userDisplayName }) => {
			console.log('onResub', broadcasterName, userName, userDisplayName);
			handleEventAndSendImageMessage(twitchBot, discordBot, { broadcasterName, userName, userDisplayName });
		});
		twitchBot.onGiftPaidUpgrade(({ broadcasterName, userName, userDisplayName }) => {
			console.log('onGiftPaidUpgrade', broadcasterName, userName, userDisplayName);
			handleEventAndSendImageMessage(twitchBot, discordBot, { broadcasterName, userName, userDisplayName });
		});
		twitchBot.onPrimePaidUpgrade(({ broadcasterName, userName, userDisplayName }) => {
			console.log('onPrimePaidUpgrade', broadcasterName, userName, userDisplayName);
			handleEventAndSendImageMessage(twitchBot, discordBot, { broadcasterName, userName, userDisplayName });
		});
		twitchBot.onStandardPayForward(({ broadcasterName, gifterName, gifterDisplayName }) => {
			console.log('onStandardPayForward', broadcasterName, gifterName, gifterDisplayName);
			handleEventAndSendImageMessage(twitchBot, discordBot, {
				broadcasterName,
				userName: gifterName,
				userDisplayName: gifterDisplayName,
				isGifting: true,
			});
		});
		twitchBot.onCommunityPayForward(({ broadcasterName, gifterName, gifterDisplayName }) => {
			console.log('onCommunityPayForward', broadcasterName, gifterName, gifterDisplayName);
			handleEventAndSendImageMessage(twitchBot, discordBot, {
				broadcasterName,
				userName: gifterName,
				userDisplayName: gifterDisplayName,
				isGifting: true,
			});
		});
		twitchBot.onCommunitySub(({ broadcasterName, gifterName, gifterDisplayName }) => {
			console.log('onCommunitySub', broadcasterName, gifterName || 'anonymous', gifterDisplayName || 'Anonymous');

			// If the gifter is banned (and not anonymous), don't generate an image for the gifter.
			// We only generate an image for the gifter in this event, not for the recipients.
			if (gifterName && isGifterBanned(broadcasterName, gifterName)) {
				console.log(`Gifter ${gifterName} is banned for ${broadcasterName}, not generating image`);
				return;
			}

			handleEventAndSendImageMessage(twitchBot, discordBot, {
				broadcasterName,
				userName: gifterName || 'Anonymous',
				userDisplayName: gifterDisplayName || 'Anonymous',
				isGifting: true,
			});
		});
		twitchBot.onSubGift(({ broadcasterName, userName, userDisplayName, gifterName }) => {
			console.log('onSubGift', broadcasterName, userName, userDisplayName);

			// Don't generate image for the recipient if:
			// a) The gifter is anonymous, OR
			// b) The gifter is banned.
			if (!gifterName || isGifterBanned(broadcasterName, gifterName)) {
				console.log(`Gifter ${gifterName || 'anonymous'} is banned for ${broadcasterName}, not generating image`);
				return;
			}
			handleEventAndSendImageMessage(twitchBot, discordBot, { broadcasterName, userName, userDisplayName });
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
const bannedGiftersFilePath = path.join(appRootDir, 'data', 'bannedGifters.json');
const logFilePath = path.join(appRootDir, 'data', 'log.txt');

const openAIManager = new OpenAIManager(env.OPENAI_API_KEY, env.OPENAI_MODEL, env.CLOUDFLARE_AI_GATEWAY);
const cfUploader = new CloudflareUploader(env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_API_TOKEN);
const twitchChannels = new Set((env.TWITCH_CHANNELS ?? '').toLowerCase().split(',').filter(Boolean));
const twitchAdmins = new Set((env.TWITCH_ADMINS ?? '').toLowerCase().split(',').filter(Boolean));
const discordChannels = env.DISCORD_CHANNELS.split(',');
const discordAdmin = env.DISCORD_ADMIN_USER_ID;
const userMeaningMap: UserMeaningMap = new Map();
const broadcasterThemeMap: BroadcasterThemeMap = new Map();
const broadcasterBannedGiftersMap: BroadcasterBannedGiftersMap = new Map();
const ignoreListManager = new IgnoreListManager(ignoreFilePath);
const messagesThrottle = throttledQueue(20, 30 * 1000, true);
const openaiThrottle = throttledQueue(500, 60 * 1000, true);
const imagesPerMinute = env.OPENAI_IMAGES_PER_MINUTE;
const maxRetries = env.MAX_RETRIES;

type DalleTemplate = {
	name: string;
	keyword: string;
	description: string;
};

const structuredOutputPrompt = `Today is __DATE__.

You are an expert in interpreting a username and creating an avatar description, delivering both creative analysis and structured documentation. You'll first create a detailed creative analysis, followed by a structured data format of that same analysis.

PART 1 - CREATIVE ANALYSIS
Create a detailed, flowing narrative analysis following these elements:

1. Reason through the necessary steps to interpret the username thoroughly and creatively
2. Interpretation of the username (taking wordplay, puns, meanings and cultural references into account)
3. Take usernames at face value, assume no typos are present

PART 2 - STRUCTURED FORMAT
Following the analysis, provide a structured breakdown of all elements:

1. Avatar Details
   - Facial expression
   - Posture
   - Looks: ALWAYS use "A cute blue round-faced avatar with blue skin" here
   - Clothing (bias towards an orange hoodie unless thematically inappropriate)
   - Accessories

2. Style and Lighting
   - Overall style
   - Lighting specifications

3. Objects in Scene (username banner with font details, additional items)
   - Banner details
     - Content (must ALWAYS be the username in quotes), additional text must go into "Additional objects"
     - Font style
     - Mood treatment
   - Additional objects (relevant to the username)
     - Types
     - Positions
     - Attributes

4. Scene Elements
   - Setting
   - Mood
   - Atmosphere
   - Background
   - Narrative (plot and avatar actions)
     - Plot points
     - Avatar actions

[COPYRIGHT-SAFE GUIDELINES]
- DO NOT directly reference specific copyrighted properties (e.g., "Dragon Ball," "Naruto").
- INSTEAD, describe general themes, genres, or tropes related to the idea. Examples:
  - "Super Saiyan" is fine, but avoid saying "Dragon Ball." Use "an epic anime transformation" or "legendary anime battle heroes" instead.
  - Replace "Dragon Balls" with "mystical glowing orbs," "legendary spheres of power," or "energy relics."
  - Replace "Dragon Ball battleground" with "an epic battlefield in an anime-inspired setting."
- Be CREATIVE and HUMOROUS in delivering these tropes while ensuring they DO NOT name or overly describe specific copyrighted works.

Guidelines:
- Be creative, degenerate, exaggerating and absurd in your scenes - aim to create humor through scene and actions
- Avoid ears, tails, or animal features unless username-relevant
- Avoid hair/physical attributes unless username-connected
- Be brave, provocative, literal, and original
- Examples of desired tone:
  - Username "diarrhea" turns to a bathroom scene with brown-stained walls, overflowing chocolate pudding toilet
  - Username "vasectomy" turns into an avatar with a doctor holding a chainsaw, fleeing patient, "Vasectomy - No refunds" sign
  - Username "breastmilk" turns into self-milking cow, baby with milk mustache, "Got Milk?" sign
  - Username "littlesp00n" turns into an avatar in bed, giant spoon cuddling next to it, "little spoon" sign
  - Username "goku_super_sayan04" becomes a playful homage to anime battle tropes, featuring glowing orbs and an energetic transformation scene.

Provide both parts in sequence, with the creative analysis flowing naturally, followed by the structured breakdown. Start directly with the interpretation, avoiding any preambles.`;

const themePrompt = `You are a master of thematic adaptation, skilled in transforming avatar descriptions and scenes to fully embody specific themes. You will receive an interpretation of a username, a detailed avatar and scene description. Your task is to boldly infuse these elements with a given theme, while maintaining the core identity of the original interpretation.

Today's theme:
__THEME__

Guidelines:
1. Make the theme a central and unmistakable element of the scene.
2. Keep the original username AS-IS and unchanged.
3. Maintain the original username interpretation.
4. Adapt the avatar's descriptions to incorporate the theme, while preserving its core identity.
4.1. For example - if the username was "Panzerfaust" and the original scene had a Panzerfaust weapon, it should still be present in the scene after adaptation.
5. Transform the scene, background, and environment to fully embody the theme.

Use the provided theme to write out reasoning steps in order to adapt the avatar and scene to the theme. 

Be imaginative, detailed, and daring in your adaptations. Ensure the theme is prominently featured throughout your response. Skip the original analysis in your response.`;

const dalleTemplates: DalleTemplate[] = [
	{
		name: 'oil painting',
		keyword: 'oil',
		description:
			'Emphasizing rich, textured brush strokes and dramatic lighting, invoking the feel of traditional oil painting.',
	},
	{
		name: 'watercolor',
		keyword: 'watercolor',
		description:
			'Soft, fluid backgrounds with gentle transitions and delicate washes, creating an ethereal and dreamy atmosphere. Subtle textures emphasize organic imperfections.',
	},
	{
		name: 'pixel art',
		keyword: 'pixel',
		description: 'Blocky and crisp with sharp lines and vibrant colors, evoking a retro, 16-bit pixel art style.',
	},
	{
		name: 'glitch art illustration',
		keyword: 'glitch',
		description:
			'Vibrant neon colors with jagged distortions and digital artifacts, creating a chaotic and futuristic atmosphere.',
	},
	{
		name: 'neon graffiti illustration',
		keyword: 'neon',
		description:
			'Bright, glowing colors and bold, jagged outlines capture the energy of neon street art, blending urban grit with vivid vibrancy. Layered textures of paint drips and spray patterns evoke a dynamic, rebellious spirit.',
	},
	{
		name: 'Byzantine art illustration',
		keyword: 'byzantine',
		description:
			'Flat, gilded backgrounds and highly stylized, geometric forms evoke the opulence and sacred symbolism of Byzantine art. Intricate patterns and jewel-like color contrasts add richness and reverence to the scene.',
	},
	{
		name: 'expressionism drawing',
		keyword: 'expressionism',
		description:
			'Bold, exaggerated lines and intense colors that convey heightened emotions and subjective experience.',
	},
	{
		name: 'charcoal drawing',
		keyword: 'charcoal',
		description:
			'Monochromatic shading with rough, textured lines, emphasizing stark contrasts and sketch-like detail.',
	},
	{
		name: 'Delicate pastel illustration',
		keyword: 'pastel_illustration',
		description:
			'A delicate and soft illustration style inspired by nostalgic Japanese aesthetics. This style features minimalist lines, subtle gradients, and pastel-like tones, evoking a calm, approachable atmosphere. The artwork avoids anime tropes and emphasizes unique, playful elements, such as distinct features like blue skin, while retaining a cozy and charming aesthetic.',
	},
	{
		name: 'Bold lines drawing with vivid colors',
		keyword: 'takahashi',
		description:
			'Exaggerated expressions, bold lines, and vivid colors evoking the playful and dynamic style of 1980s anime.',
	},
	{
		name: 'Detailed line work drawing',
		keyword: 'sadamoto',
		description:
			'Detailed line work, subdued color palettes, and melancholic atmospheres, reflecting a moody and introspective style.',
	},
	{
		name: 'fauvism painting',
		keyword: 'fauvism',
		description: 'Bold, vibrant colors with expressive brushstrokes, emphasizing abstraction and emotional intensity.',
	},
	{
		name: 'flat design illustration',
		keyword: 'flat',
		description: 'Simplified shapes and bold colors, creating a clean and modern flat design aesthetic.',
	},
	{
		name: 'sketch art',
		keyword: 'sketch',
		description: 'Loose, rough lines with an emphasis on expressive, hand-drawn quality and organic textures.',
	},
	{
		name: 'Baroque oil painting',
		keyword: 'baroque',
		description:
			'Dramatic compositions with rich, textured brushstrokes and dynamic lighting, emphasizing grandeur and emotional intensity. Elaborate details and strong contrasts between light and shadow evoke the opulence and theatricality of Baroque art, perfect for epic, storytelling scenes.',
	},
	{
		name: 'Romanticism landscape painting',
		keyword: 'romanticism',
		description:
			"Sweeping, emotional landscapes with bold, atmospheric effects. Romanticism emphasizes the sublime, portraying nature's grandeur and humanity's smallness. Dynamic skies, rugged mountains, and turbulent seas dominate, using rich, textured brushstrokes to create epic, evocative scenery.",
	},
	{
		name: 'Art Nouveau stained glass',
		keyword: 'art_nouveau',
		description:
			'Elegant compositions with sweeping organic curves and flowing natural forms. Rich jewel tones blend with delicate patterns inspired by botanical motifs. Ornate decorative elements and graceful linework create an atmosphere of refined beauty and sophisticated grandeur.',
	},
	{
		name: 'Classical fresco painting',
		keyword: 'fresco',
		description:
			'Monumental architectural scenes with soaring columns and vaulted ceilings, rendered in earthy pigments and soft matte textures characteristic of ancient wall paintings. Dramatic natural light streams through classical arches, illuminating weathered stone surfaces and creating depth through architectural perspective.',
	},
	{
		name: 'Pointillism painting',
		keyword: 'pointillism',
		description:
			'Vibrant scenes composed entirely of small, distinct dots of pure color, creating luminous optical effects and shimmering atmospheric light through careful dot placement.',
	},
	{
		name: 'Art Deco illustration',
		keyword: 'art_deco',
		description:
			'Bold geometric shapes and streamlined forms with metallic gold and silver accents. Symmetrical compositions featuring stepped forms and sunburst patterns create a sense of luxury and modern sophistication.',
	},
	{
		name: 'Ukiyo-e woodblock print',
		keyword: 'ukiyoe',
		description:
			'Bold outlines and flat areas of vibrant color with detailed patterns. Elegant compositions emphasize decorative elements and create depth through layered planes.',
	},
	{
		name: 'Vaporwave illustration',
		keyword: 'vaporwave',
		description:
			'Surreal compositions with bold gradients and glowing neon elements. Retro-futuristic elements blend with geometric patterns in saturated purple and teal tones.',
	},
	{
		name: 'Risograph print',
		keyword: 'risograph',
		description:
			'Bold two-tone compositions with slight misalignment and textural grain. Vibrant spot colors overlap to create unexpected combinations with a distinctive printed quality.',
	},
	{
		name: 'Gouache painting',
		keyword: 'gouache',
		description:
			'Matte, opaque colors with smooth transitions and precise edges. Rich pigments blend seamlessly while maintaining crisp details and bold graphic qualities.',
	},
	{
		name: 'Acrylic painting',
		keyword: 'acrylic',
		description:
			'Vivid, textured surfaces with bold brushstrokes and vibrant colors. Thick impasto layers create dynamic textures and expressive mark-making.',
	},
];

/*
 * DALL-E throttling
 * Tier 1: 5 requests per minute
 * Tier 2: 7 requests per minute
 * Tier 3: 7 requests per minute
 * Tier 4: 15 requests per minute
 * Tier 5: 50 requests per minute
 * Tier 6: 200 requests per minute
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
		ensureFileExists(bannedGiftersFilePath, JSON.stringify({})),
		ignoreListManager.loadIgnoreList(),
	]);

	await loadThemes(themeFilePath);
	await loadMeanings(meaningsFilePath);
	await loadBannedGifters(bannedGiftersFilePath);

	console.log(`Using token file: ${tokenFilePath}`);
	console.log(`Using images file: ${imagesFilePath}`);
	console.log(`Using meanings file: ${meaningsFilePath}`);
	console.log(`Using themes file: ${themeFilePath}`);
	console.log(`Using ignore file: ${ignoreFilePath}`);
	console.log(`Using banned gifters file: ${bannedGiftersFilePath}`);
	for (const [broadcaster, bannedGifters] of broadcasterBannedGiftersMap) {
		console.log(`Banned gifters for ${broadcaster}: ${bannedGifters.join(', ')}`);
	}
	console.log(`Using OpenAI model: ${env.OPENAI_MODEL}`);
	console.log('Twitch admins:', Array.from(twitchAdmins).join(', '));

	await main();
} catch (error: unknown) {
	if (error instanceof Error) {
		console.error(error.message);
	}
}
