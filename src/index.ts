import 'dotenv/config';
import * as path from 'path';
import { promises as fs } from 'fs';
import { env } from './env';
import OpenAI from 'openai';
import { AccessToken, InvalidTokenError, RefreshingAuthProvider } from '@twurple/auth';
import { Bot, createBotCommand } from '@twurple/easy-bot';
import { ActivityType, Client as DiscordClient, Events, GatewayIntentBits, Partials, TextChannel } from 'discord.js';
import throttledQueue from 'throttled-queue';
import { IgnoreListManager } from './managers/IgnoreListManager';
import { CloudflareUploader } from './utils/CloudflareUploader';
import { OpenAIManager } from './utils/OpenAIManager';
import { nanoid } from 'nanoid';
import {
	MAX_RETRIES,
	MESSAGE_THROTTLE_LIMIT,
	MESSAGE_THROTTLE_INTERVAL_MS,
	OPENAI_THROTTLE_LIMIT,
	OPENAI_THROTTLE_INTERVAL_MS,
	DALLE_THROTTLE_LIMIT,
	DALLE_THROTTLE_INTERVAL_MS,
} from './constants/config';
import { DALLE_IMAGE_PROMPT_TEMPLATE } from './constants/prompts';
import { DALLE_TEMPLATES, DalleTemplate } from './constants/styles';
import { ThemeManager } from './managers/ThemeManager';
import { MeaningManager } from './managers/MeaningManager';
import { BannedGifterManager } from './managers/BannedGifterManager';
import { ImageDataStore } from './managers/ImageDataStore';
import {
	isAdminOrBroadcaster,
	ensureFileExists,
	getAppRootDir,
	exists,
	retryAsyncOperation,
	truncate,
	createSystemPrompt,
} from './utils/helpers';
import { finalSchema } from './schemas/imageSchemas';

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

interface EventData {
	broadcasterName: string;
	userName: string;
	userDisplayName: string;
	isGifting?: boolean;
}

const testGenerationState = {
	isRunning: false,
	shouldCancel: false,
};

async function generateImage(
	username: string,
	userDisplayName: string,
	metadata: Record<string, unknown> = {},
	theme: string | undefined,
	style: string | null = null,
): Promise<ImageGenerationResult> {
	const uniqueId = nanoid(14);

	let template: DalleTemplate | undefined;
	if (style) {
		template = DALLE_TEMPLATES.find((t) => t.keyword.toLowerCase() === style!.toLowerCase());
	}
	if (!template) {
		const templateIndex = Math.floor(Math.random() * DALLE_TEMPLATES.length);
		template = DALLE_TEMPLATES[templateIndex] as DalleTemplate;
		style = template.keyword.toLowerCase();
	}

	const userMeaning = meaningManager.getUserMeaning(username.toLowerCase());
	const queryMessage =
		userMeaning !== username
			? `Literal username: ${userDisplayName}\nIntended meaning: ${userMeaning}`
			: `Username: ${userDisplayName}`;

	console.log(`[${uniqueId}]`, userMeaning, `Using template: ${template.name}`);

	const structuredAnalysisMessages: OpenAI.ChatCompletionMessageParam[] = [
		{
			role: 'system',
			content: createSystemPrompt(new Date().toISOString().slice(0, 10), theme),
		},
		{
			role: 'user',
			content: queryMessage,
		},
	];

	let structuredOutput = await openaiThrottle(() => {
		console.log(`[${uniqueId}]`, userMeaning, `Requesting structured output (Theme: ${theme ?? 'None'})`);
		return openAIManager.getChatCompletion(structuredAnalysisMessages, {
			length: 700,
			schema: finalSchema,
			schemaName: 'finalSchema',
		});
	});

	const analysisResult = `Literal username: ${userDisplayName}\n${JSON.stringify(structuredOutput, null, 2)}`;

	Object.assign(structuredOutput.step2, { style: template.description });
	Object.assign(structuredOutput.step2, { style_description: template.name });

	const imagePrompt = JSON.stringify(structuredOutput.step2);

	const image = await dalleThrottle(() => {
		console.log(`[${uniqueId}]`, userMeaning, `Creating image.`);
		return openAIManager.generateImage({
			model: 'dall-e-3',
			prompt: DALLE_IMAGE_PROMPT_TEMPLATE.replace('__DATA__', imagePrompt),
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
		theme: theme ?? '',
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
		const theme = themeManager.getBroadcasterTheme(broadcasterName);
		imageResult = await retryAsyncOperation(generateImage, MAX_RETRIES, userName, userDisplayName, metadata, theme);
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

	await imageDataStore.storeImageData(broadcasterName, userName, {
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
				const theme = themeManager.getBroadcasterTheme(broadcasterName);
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
						MAX_RETRIES,
						param.toLowerCase(),
						param,
						metadata,
						theme,
					);
					if (!imageResult.success) {
						await message.reply(`Unable to generate image for ${param}`);
						continue;
					}
					await imageDataStore.storeImageData(broadcasterName, param, {
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
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) {
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
					const theme = themeManager.getBroadcasterTheme(broadcasterName);
					imageResult = await retryAsyncOperation(
						generateImage,
						MAX_RETRIES,
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
				await imageDataStore.storeImageData(broadcasterName, params[0], {
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
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) {
					return;
				}

				if (params.length === 0) {
					await messagesThrottle(() => {
						return say(`@${userName} Please provide a theme.`);
					});
					return;
				}

				const theme = params.join(' ');
				await themeManager.setTheme(broadcasterName.toLowerCase(), theme);

				await messagesThrottle(() => {
					return say(`@${userName} Theme set to: ${theme}`);
				});
			}),
			createBotCommand('deltheme', async (_params, { userName, broadcasterName, say }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) {
					return;
				}

				await themeManager.removeTheme(broadcasterName.toLowerCase());

				await messagesThrottle(() => {
					return say(`@${userName} Theme removed.`);
				});
			}),
			createBotCommand('gettheme', async (_params, { userName, broadcasterName, say }) => {
				const theme = themeManager.getBroadcasterTheme(broadcasterName.toLowerCase());
				await messagesThrottle(() => {
					if (!theme) {
						return say(`@${userName} No theme set.`);
					}

					return say(`@${userName} Current theme: ${theme}`);
				});
			}),
			createBotCommand('setmeaning', async (params, { userName, broadcasterName, say }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) {
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
				await meaningManager.setMeaning(user.toLowerCase(), meaning);

				await messagesThrottle(() => {
					return say(`@${userName} Meaning for ${user} set.`);
				});
			}),
			createBotCommand('delmeaning', async (params, { userName, broadcasterName, say }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) {
					return;
				}

				if (params.length !== 1) {
					await messagesThrottle(() => {
						return say(`@${userName} Please provide a username.`);
					});
					return;
				}
				const user = params[0];
				const wasRemoved = await meaningManager.removeMeaning(user.toLowerCase());

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
				const meaning = meaningManager.getUserMeaning(user.toLowerCase());
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
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) {
					return;
				}

				if (params.length !== 1) {
					await messagesThrottle(() => {
						return say(`@${userName} Please provide a username.`);
					});
					return;
				}

				const gifter = params[0];
				await bannedGifterManager.addBannedGifter(broadcasterName, gifter);

				await messagesThrottle(() => {
					return say(`@${userName} Gifter ${gifter} banned. Sub gifts from this user will be ignored.`);
				});
			}),
			createBotCommand('unbangifter', async (params, { userName, broadcasterName, say }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) {
					return;
				}

				if (params.length !== 1) {
					await messagesThrottle(() => {
						return say(`@${userName} Please provide a username.`);
					});
					return;
				}

				const gifter = params[0];
				const wasRemoved = await bannedGifterManager.removeBannedGifter(broadcasterName, gifter);

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
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) {
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
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) {
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
				const count = params.length > 1 ? parseInt(params[1], 10) : 1;

				if (isNaN(count) || count < 1) {
					await messagesThrottle(() => {
						return say(`@${userName} Please provide a valid number of images to generate.`);
					});
					return;
				}

				const startTime = Date.now();
				testGenerationState.isRunning = true;
				testGenerationState.shouldCancel = false;

				const totalTasks = count * DALLE_TEMPLATES.length;
				await messagesThrottle(() => {
					return say(
						`@${userName} Starting test generation for ${target} with ${count} image(s) per style. Total images: ${totalTasks}`,
					);
				});

				let successCount = 0;
				let failureCount = 0;
				const theme = themeManager.getBroadcasterTheme(broadcasterName);

				const generationTasks = [];
				for (const template of DALLE_TEMPLATES) {
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
									MAX_RETRIES,
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
								await imageDataStore.storeImageData(broadcasterName, target, {
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
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) {
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
			if (gifterName && bannedGifterManager.isGifterBanned(broadcasterName, gifterName)) {
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
			if (!gifterName || bannedGifterManager.isGifterBanned(broadcasterName, gifterName)) {
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
const ignoreListManager = new IgnoreListManager(ignoreFilePath);
const themeManager = new ThemeManager(themeFilePath);
const meaningManager = new MeaningManager(meaningsFilePath);
const bannedGifterManager = new BannedGifterManager(bannedGiftersFilePath);
const imageDataStore = new ImageDataStore(imagesFilePath);
const messagesThrottle = throttledQueue(MESSAGE_THROTTLE_LIMIT, MESSAGE_THROTTLE_INTERVAL_MS, true);
const openaiThrottle = throttledQueue(OPENAI_THROTTLE_LIMIT, OPENAI_THROTTLE_INTERVAL_MS, true);
const dalleThrottle = throttledQueue(DALLE_THROTTLE_LIMIT, DALLE_THROTTLE_INTERVAL_MS, true);

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

	await themeManager.loadThemes();
	await meaningManager.loadMeanings();
	await bannedGifterManager.loadBannedGifters();

	console.log(`Using token file: ${tokenFilePath}`);
	console.log(`Using images file: ${imagesFilePath}`);
	console.log(`Using meanings file: ${meaningsFilePath}`);
	console.log(`Using themes file: ${themeFilePath}`);
	console.log(`Using ignore file: ${ignoreFilePath}`);
	console.log(`Using banned gifters file: ${bannedGiftersFilePath}`);
	for (const [broadcaster, bannedGifters] of bannedGifterManager.getMap()) {
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
