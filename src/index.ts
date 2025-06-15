import 'dotenv/config';
import * as path from 'path';
import { promises as fsPromises } from 'fs'; // Renamed to avoid conflict with my 'fs' variable if I make one
import { env } from './env';
import OpenAI from 'openai';
import { AccessToken, InvalidTokenError, RefreshingAuthProvider } from '@twurple/auth';
import { Bot, createBotCommand } from '@twurple/easy-bot';
import { ActivityType, Client as DiscordClient, Events, GatewayIntentBits, Partials, TextChannel, Message } from 'discord.js';
import throttledQueue from 'throttled-queue';

// New Manager Imports
import { query } from './utils/DatabaseManager'; // Assuming DatabaseManager exports query
import { BotConfigManager } from './managers/BotConfigManager';
import { IgnoreListManager } from './managers/IgnoreListManager';
// import { ThemeManager } from './managers/ThemeManager'; // Removed
import { MeaningManager } from './managers/MeaningManager';
import { BannedGifterManager } from './managers/BannedGifterManager';
import { ImageDataStore } from './managers/ImageDataStore'; // Still used for its storeImageData, which now writes to DB

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
import {
	isAdminOrBroadcaster,
	// ensureFileExists, // No longer needed for DB based managers for primary data
	getAppRootDir,
	// exists, // No longer needed for token file
	retryAsyncOperation,
	truncate,
	createSystemPrompt,
} from './utils/helpers';
import { finalSchema } from './schemas/imageSchemas';


// Type for the result of image generation, now includes request_id
type ImageGenerationSuccess = {
	success: true;
	message: string; // Cloudflare URL
	analysis: string;
	revisedPrompt: string;
	requestId: number; // From image_generation_logs
};

type ImageGenerationError = {
	success: false;
	message: string; // Error message
	requestId?: null; // Optional: if logging happened before failure point
};

type ImageGenerationResult = ImageGenerationSuccess | ImageGenerationError;

interface EventData {
	broadcasterName: string;
	userName: string;
	userDisplayName: string;
	isGifting?: boolean;
	triggerEvent: string; // e.g., "sub", "resub", "custom_command"
}

const testGenerationState = {
	isRunning: false,
	shouldCancel: false,
};

// --- Instantiate New Managers ---
const botConfigManager = new BotConfigManager();
const ignoreListManager = new IgnoreListManager();
// const themeManager = new ThemeManager(); // Instance removed
const meaningManager = new MeaningManager();
const bannedGifterManager = new BannedGifterManager();
const imageDataStore = new ImageDataStore(); // Keeps its name, but behavior changed

const openAIManager = new OpenAIManager(env.OPENAI_API_KEY, env.OPENAI_MODEL, env.CLOUDFLARE_AI_GATEWAY);
const cfUploader = new CloudflareUploader(env.CLOUDFLARE_ACCOUNT_ID, env.CLOUDFLARE_API_TOKEN);
const twitchChannels = new Set((env.TWITCH_CHANNELS ?? '').toLowerCase().split(',').filter(Boolean));
const twitchAdmins = new Set((env.TWITCH_ADMINS ?? '').toLowerCase().split(',').filter(Boolean));
const discordChannels = env.DISCORD_CHANNELS.split(',');
const discordAdmin = env.DISCORD_ADMIN_USER_ID;

const messagesThrottle = throttledQueue(MESSAGE_THROTTLE_LIMIT, MESSAGE_THROTTLE_INTERVAL_MS, true);
const openaiThrottle = throttledQueue(OPENAI_THROTTLE_LIMIT, OPENAI_THROTTLE_INTERVAL_MS, true);
const dalleThrottle = throttledQueue(DALLE_THROTTLE_LIMIT, DALLE_THROTTLE_INTERVAL_MS, true);
const logFilePath = path.join(await getAppRootDir(), 'data', 'log.txt'); // Log file path still used


async function generateImage(
	username: string, // Twitch username, lowercased
	userDisplayName: string, // Twitch display name
	// broadcasterId: string, // Twitch broadcaster ID/name, lowercased -- REMOVED
	triggerEvent: string, // e.g. "sub", "gift", "command:aisweatling"
	rawUserInput: string, // The original text from user if applicable (e.g. prompt for a command)
	theme: string | undefined,
	style: string | null = null,
	metadata: Record<string, unknown> = {}, // Additional metadata for CF
): Promise<ImageGenerationResult> {
	const uniqueId = nanoid(14); // For console logging during generation

	let template: DalleTemplate | undefined;
	if (style) {
		template = DALLE_TEMPLATES.find((t) => t.keyword.toLowerCase() === style!.toLowerCase());
	}
	if (!template) {
		const templateIndex = Math.floor(Math.random() * DALLE_TEMPLATES.length);
		template = DALLE_TEMPLATES[templateIndex] as DalleTemplate;
		style = template.keyword.toLowerCase(); // Update style if randomly chosen
	}

	const userMeaning = meaningManager.getUserMeaning(username); // username is already lowercased
	const systemDate = new Date().toISOString().slice(0, 10);
	const systemPrompt = createSystemPrompt(systemDate, theme);

	// Construct a more descriptive raw_user_input for logging if it's not directly from a user command
	// broadcasterId removed from this string
	const effectiveRawUserInput = rawUserInput || `Trigger: ${triggerEvent} for ${userDisplayName}`;

	const structuredAnalysisMessages: OpenAI.ChatCompletionMessageParam[] = [
		{ role: 'system', content: systemPrompt },
		{ role: 'user', content: userMeaning !== username ? `Literal username: ${userDisplayName}\nIntended meaning: ${userMeaning}` : `Username: ${userDisplayName}` },
	];

	console.log(`[${uniqueId}] User: ${userDisplayName}, Meaning: ${userMeaning}, Using template: ${template.name}, Theme: ${theme ?? 'None'}`);

	let structuredOutput;
	let analysisResultForLog: string;
	let imagePromptForDallE: string;
	let revisedPromptFromDallE: string | undefined;
	let finalUrl: string | undefined;
	let preGenRequestId: number | null = null;

	try {
		// Initial log entry (before OpenAI calls)
		// This helps trace requests even if subsequent steps fail.
		const initialLogSql = `
			INSERT INTO image_generation_logs (user_id, trigger_event, raw_user_input, openai_request_prompt, success, generation_timestamp)
			VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP) RETURNING request_id;
		`; // broadcaster_id removed, parameter placeholders adjusted ($1-$5)
		// Tentative prompt for initial log. This will be updated later.
		const tentativePrompt = `User: ${userDisplayName}, Meaning: ${userMeaning}, Style: ${template.name}, Theme: ${theme ?? 'Default'}`;
		// broadcasterId removed from params list
		const initialLogRes = await query(initialLogSql, [username, triggerEvent, effectiveRawUserInput, tentativePrompt, false]);
		preGenRequestId = initialLogRes.rows[0]?.request_id;

		if (!preGenRequestId) {
			throw new Error("Failed to create initial log entry and get request_id.");
		}
		console.log(`[${uniqueId}] User: ${userDisplayName}, Initial log created with request_id: ${preGenRequestId}`);


		structuredOutput = await openaiThrottle(() => {
			console.log(`[${uniqueId}] User: ${userDisplayName}, Requesting structured output (Theme: ${theme ?? 'None'})`);
			return openAIManager.getChatCompletion(structuredAnalysisMessages, {
				length: 700, schema: finalSchema, schemaName: 'finalSchema',
			});
		});

		analysisResultForLog = `Literal username: ${userDisplayName}\n${JSON.stringify(structuredOutput, null, 2)}`;
		Object.assign(structuredOutput.step2, { style: template.description, style_description: template.name });
		imagePromptForDallE = JSON.stringify(structuredOutput.step2);

		// Update log with actual OpenAI prompt
		await query(
			'UPDATE image_generation_logs SET openai_request_prompt = $1, openai_request_parameters = $2 WHERE request_id = $3',
			[imagePromptForDallE, { model: 'dall-e-3', quality: 'standard', size: '1024x1024' } as any, preGenRequestId]
		);

		const image = await dalleThrottle(() => {
			console.log(`[${uniqueId}] User: ${userDisplayName} Creating image with DALL-E.`);
			return openAIManager.generateImage({
				model: 'dall-e-3', prompt: DALLE_IMAGE_PROMPT_TEMPLATE.replace('__DATA__', imagePromptForDallE),
				quality: 'standard', size: '1024x1024', response_format: 'url',
			});
		});

		revisedPromptFromDallE = image.data[0].revised_prompt;
		const tempImageUrl = image.data[0].url!;
		console.log(`[${uniqueId}] User: ${userDisplayName} DALL-E image generated. Revised prompt: ${revisedPromptFromDallE}`);

		// Update log with DALL-E response data (excluding full image URL for now if it's temporary)
        await query(
            'UPDATE image_generation_logs SET openai_response_data = $1, revised_prompt = $2 WHERE request_id = $3',
            [{ dalle_revised_prompt: revisedPromptFromDallE } as any, revisedPromptFromDallE, preGenRequestId]
        );

		console.log(`[${uniqueId}] User: ${userDisplayName} Uploading image to Cloudflare.`);
		// broadcasterId (channel) removed from cfMetadata if it was only for that, or use a global/default if needed by CF
		const cfMetadata = { ...metadata, source: triggerEvent, /* channel: broadcasterId, */ user: username, theme: theme ?? '', style: style! };
		const uploadedImage = await cfUploader.uploadImageFromUrl(tempImageUrl, cfMetadata);

		if (!uploadedImage.success) {
			throw new Error(`Image upload failed: ${uploadedImage.errors?.map(e => e.message).join(', ')}`);
		}

		finalUrl = `${env.CLOUDFLARE_IMAGES_URL}/${uploadedImage.result.id}.png`;
		console.log(`[${uniqueId}] User: ${userDisplayName} Image uploaded: ${finalUrl}`);

		// Final update to log: success and Cloudflare URL
		await query(
			'UPDATE image_generation_logs SET success = $1, cloudflare_image_url = $2, analysis = $3, generated_image_url = $4 WHERE request_id = $5',
			[true, finalUrl, analysisResultForLog, tempImageUrl, preGenRequestId]
		);

		return {
			success: true, message: finalUrl, analysis: analysisResultForLog,
			revisedPrompt: revisedPromptFromDallE!, requestId: preGenRequestId,
		};

	} catch (error: any) {
		console.error(`[${uniqueId}] Error during image generation for ${userDisplayName}:`, error);
		if (preGenRequestId) {
			await query(
				'UPDATE image_generation_logs SET success = $1, error_message = $2 WHERE request_id = $3',
				[false, error.message || 'Unknown error during generation', preGenRequestId]
			);
		}
		return { success: false, message: error.message || 'Error generating image', requestId: preGenRequestId ?? null };
	}
}


async function handleEventAndSendImageMessage(
	twitchBot: Bot,
	discordBot: DiscordClient,
	eventData: EventData,
): Promise<void> {
	const { broadcasterName, userName, userDisplayName, isGifting = false, triggerEvent } = eventData;

	if (ignoreListManager.isUserIgnored(userName.toLowerCase())) {
		console.log(`User ${userName} is ignored, not generating image`);
		return;
	}
	const verb = isGifting ? 'gifting' : triggerEvent; // Use triggerEvent for more context if not just gifting/sub

	let imageResult: ImageGenerationResult;
	try {
		const metadata = { source: 'twitch', channel: broadcasterName, target: userName, trigger: verb };
		// const theme = themeManager.getBroadcasterTheme(broadcasterName.toLowerCase()); // Old theme logic
		const theme = await botConfigManager.getCurrentBotTheme(); // New theme logic
		// Pass triggerEvent and relevant user input if applicable
		const rawUserInput = `Event: ${triggerEvent}`; // Example, adjust if more specific input is available
		imageResult = await retryAsyncOperation(
			generateImage, MAX_RETRIES, userName.toLowerCase(), userDisplayName, /* broadcasterName.toLowerCase() REMOVED */
			triggerEvent, rawUserInput, theme ?? undefined, null, metadata // Use theme ?? undefined to pass string or undefined
		);
	} catch (error: any) {
		imageResult = { success: false, message: error.message || 'Error in retryAsyncOperation for image generation' };
	}

	if (!imageResult.success) {
		await messagesThrottle(() => {
			return twitchBot.say(
				broadcasterName,
				`Thank you @${userDisplayName} for ${verb} dnkLove Unfortunately, I was unable to generate an image for you.`,
			);
		});
		return;
	}

	// imageDataStore.storeImageData is no longer needed here if generateImage handles all DB logging.
	// The request_id is now in imageResult.requestId

	for (const channelId of discordChannels) {
		const channel = discordBot.channels.cache.get(channelId) as TextChannel;
		if (channel && channel.isTextBased() && channel.isSendable()) {
			try {
				const sentMessage: Message = await channel.send({
					content: `Thank you \`${userDisplayName}\` for ${verb}. Here's your sweatling: ${imageResult.message}`,
				});

				// Store discord_message_id and add reactions
				if (imageResult.requestId) {
					await query('UPDATE image_generation_logs SET discord_message_id = $1 WHERE request_id = $2', [sentMessage.id, imageResult.requestId]);
					try {
						await sentMessage.react(env.DISCORD_UPVOTE_EMOJI || '👍');
						await sentMessage.react(env.DISCORD_DOWNVOTE_EMOJI || '👎');
					} catch (reactionError) {
						console.error('Error adding auto-reactions:', reactionError);
					}
				}
			} catch (error) {
				console.log(`Error sending message to Discord channel ${channelId}`, error);
			}
		}
	}

	await messagesThrottle(() => {
		console.log(`Sending ${verb} image to Twitch chat for ${userDisplayName}`);
		return twitchBot.say(
			broadcasterName,
			`Thank you @${userDisplayName} for ${verb} dnkLove This is for you: ${imageResult.message}`,
		);
	});
}

async function main() {
	try {
		// --- Load data for managers ---
		await ignoreListManager.loadIgnoreList();
		// await themeManager.loadThemes(); // Load call removed
		await meaningManager.loadMeanings();
		await bannedGifterManager.loadBannedGifters();
		// imageDataStore does not have a load method as it's write-only to DB / or handled by a service
		// botConfigManager fetches values on demand

		console.log('All managers initialized and data loaded.');

		const discordBot = new DiscordClient({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.DirectMessages,
				GatewayIntentBits.GuildMessageReactions, // Needed for reaction events
				GatewayIntentBits.MessageContent, // May be needed depending on commands
			],
			partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User], // Added Reaction and User
			presence: {
				activities: [{ name: 'ImageGenerations', state: `🖼️ generating images`, type: ActivityType.Custom }],
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
				const adminUser = discordBot.users.cache.get(discordAdmin);
				if (adminUser) {
					await adminUser.createDM();
					console.log('Discord admin DM channel ready.');
				} else {
					console.warn(`Discord admin user with ID ${discordAdmin} not found in cache.`);
				}
			} catch (error) {
				console.log('Discord error during ClientReady admin DM setup:', error);
			}
		});

		// --- New Discord Reaction Event Listeners ---
		discordBot.on(Events.MessageReactionAdd, async (reaction, user) => {
			if (user.bot) return; // Ignore reactions from bots

			const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
			const emojiName = reaction.emoji.name || reaction.emoji.id; // Use name for unicode, id for custom
			const reactorUserId = user.id;

			try {
				const logResult = await query('SELECT request_id FROM image_generation_logs WHERE discord_message_id = $1;', [message.id]);
				if (logResult.rows.length > 0) {
					await query(
						'INSERT INTO discord_message_reactions (discord_message_id, user_id, emoji, reaction_timestamp) VALUES ($1, $2, $3, CURRENT_TIMESTAMP) ON CONFLICT (discord_message_id, user_id, emoji) DO NOTHING;',
						[message.id, reactorUserId, emojiName]
					);
					console.log(`Reaction ${emojiName} by ${reactorUserId} on message ${message.id} stored.`);
				}
			} catch (dbError) {
				console.error('Error storing Discord reaction:', dbError);
			}
		});

		discordBot.on(Events.MessageReactionRemove, async (reaction, user) => {
			if (user.bot) return;

			const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
			const emojiName = reaction.emoji.name || reaction.emoji.id;
			const reactorUserId = user.id;

			try {
				const logResult = await query('SELECT request_id FROM image_generation_logs WHERE discord_message_id = $1;', [message.id]);
				if (logResult.rows.length > 0) {
					await query(
						'DELETE FROM discord_message_reactions WHERE discord_message_id = $1 AND user_id = $2 AND emoji = $3;',
						[message.id, reactorUserId, emojiName]
					);
					console.log(`Reaction ${emojiName} by ${reactorUserId} on message ${message.id} removed from DB.`);
				}
			} catch (dbError) {
				console.error('Error removing Discord reaction from DB:', dbError);
			}
		});


		discordBot.on(Events.MessageCreate, async (message) => {
			if (message.author.bot) return; // Ignore messages from bots

			const admin = discordBot.users.cache.get(discordAdmin) ?? (await discordBot.users.fetch(discordAdmin));

			if (message.guild !== null) { // Only process DMs for these commands
				return;
			}

			if (message.author.id !== discordAdmin) {
				await message.reply(`This communication channel is not monitored. Please contact ${admin.username} directly.`);
				return;
			}

			console.log(`Discord DM received from admin: ${message.content}`);
			const [command, ...params] = message.content.split(' ');

			if (command === '!announce') {
				// ... (announce logic remains mostly the same)
				const announcement = params.join(' ');
				if (!announcement) {
					await message.channel.send(`Please provide an announcement.`);
					return;
				}
				await message.reply(`Announcing: ${announcement}`);
				for (const channelId of discordChannels) {
					const channel = discordBot.channels.cache.get(channelId) as TextChannel;
					if (channel && channel.isTextBased() && channel.isSendable()) {
						try {
							await channel.send(announcement);
						} catch (error) {
							console.log(`Error sending announcement to channel ${channelId}`, error);
						}
					}
				}
			} else if (command === '!generateimage') {
				const broadcasterName = params[0]?.toLowerCase(); // This command might be deprecated or changed in single-broadcaster model
				if (!broadcasterName) {
					// For single broadcaster, broadcasterName for theme lookup might not be needed.
					// However, the command takes it, so we use it for context if other parts need it.
					// If the command is to generate for specific users, it might still be relevant.
					// For now, let's assume it's kept for potential user context, but theme is global.
					// We could also choose to make broadcasterName optional here if truly single-channel.
					// For now, require it for this specific admin command structure.
					await message.reply("Please specify a broadcaster name (legacy for user context). Theme will be global.");
					return;
				}
				// const theme = themeManager.getBroadcasterTheme(broadcasterName); // Old theme logic
				const theme = await botConfigManager.getCurrentBotTheme(); // New theme logic
				const usersToGenerateFor = params.slice(1);

				if (usersToGenerateFor.length === 0) {
					await message.reply("Please specify at least one username to generate an image for.");
					return;
				}

				for (const targetUser of usersToGenerateFor) {
					const metadata = { source: 'discord_admin_cmd', /* channel: broadcasterName, */ target: targetUser, trigger: 'custom_admin' };
					imageResult = await retryAsyncOperation(
						generateImage, MAX_RETRIES, targetUser.toLowerCase(), targetUser, /* broadcasterName REMOVED */
						'discord_admin_command', `Admin command for ${targetUser}`, theme ?? undefined, null, metadata
					);

					if (!imageResult.success) {
						await message.reply(`Unable to generate image for ${targetUser}. Error: ${imageResult.message}`);
						continue;
					}

					// generateImage now handles its own DB logging.
					// No need for imageDataStore.storeImageData(...) here.

					for (const channelId of discordChannels) {
						const channel = discordBot.channels.cache.get(channelId) as TextChannel;
						if (channel && channel.isTextBased() && channel.isSendable()) {
							try {
								const sentMessage = await channel.send(
									`Admin \`${message.author.username}\` triggered generation for \`${targetUser}\`. Here's the sweatling: ${imageResult.message}`,
								);
								if (imageResult.requestId) {
									await query('UPDATE image_generation_logs SET discord_message_id = $1 WHERE request_id = $2', [sentMessage.id, imageResult.requestId]);
									try {
										await sentMessage.react(env.DISCORD_UPVOTE_EMOJI || '👍');
										await sentMessage.react(env.DISCORD_DOWNVOTE_EMOJI || '👎');
									} catch (reactionError) {
										console.error('Error adding auto-reactions to admin generated image:', reactionError);
									}
								}
							} catch (error) {
								console.log(`Error sending admin-generated image to Discord channel ${channelId}`, error);
							}
						}
					}
					await message.reply(`Image for ${targetUser} generated: ${imageResult.message}`);
				}
			} else {
				await message.reply(`Unknown command. Available DM commands: !announce <message>, !generateimage <broadcaster> <user1> [user2...]`);
			}
		});

		discordBot.login(env.DISCORD_BOT_TOKEN).catch((error) => {
			console.log('Discord bot login failed', error);
		});

		// --- Twitch Authentication using BotConfigManager ---
		const initialAccessToken = await botConfigManager.getTwitchAccessToken();
		const initialRefreshToken = await botConfigManager.getTwitchRefreshToken();

		if (!initialAccessToken || !initialRefreshToken) {
			console.error('Twitch access token or refresh token is missing from configuration. Cannot start Twitch bot.');
			// Optionally, exit or prevent Twitch bot initialization
			return;
		}

		let tokenData: AccessToken = {
			accessToken: initialAccessToken,
			refreshToken: initialRefreshToken,
			expiresIn: 0, // Will be updated by Twurple
			obtainmentTimestamp: 0, // Will be updated by Twurple
			scope: ['chat:edit', 'chat:read'], // Ensure scopes match your needs
		};

		const twitchClientId = await botConfigManager.getTwitchClientId();
		const twitchClientSecret = await botConfigManager.getTwitchClientSecret();

		if (!twitchClientId || !twitchClientSecret) {
			console.error('Twitch Client ID or Client Secret is missing from BotConfigManager. Cannot start Twitch bot.');
			return;
		}


		const authProvider = new RefreshingAuthProvider({
			clientId: twitchClientId,
			clientSecret: twitchClientSecret,
		});

		authProvider.onRefresh(async (_userId, newTokenData) => {
			await botConfigManager.setTwitchAccessToken(newTokenData.accessToken);
			await botConfigManager.setTwitchRefreshToken(newTokenData.refreshToken ?? ''); // Ensure refreshToken is not null
			tokenData = newTokenData; // Update in-memory tokenData as well
			console.log('Twitch token refreshed and updated in database.');
		});
		authProvider.onRefreshFailure((error) => {
			console.error('Failed to refresh Twitch token:', error);
		});

		try {
			await authProvider.addUserForToken(tokenData, ['chat']);
		} catch (error) {
			if (error instanceof InvalidTokenError) {
				console.error('Initial Twitch token is invalid. Please re-authenticate or check stored tokens.', error);
				// Potentially trigger a re-authentication flow or guide user
				return;
			}
			throw error; // Re-throw other errors
		}


		const commands = [
			createBotCommand('aisweatling', async (params, { userName, broadcasterName, say }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) {
					return;
				}
				if (params.length === 0) {
					say("Please provide a target username.");
					return;
				}

				const target = params[0].replace('@', '');
				if (ignoreListManager.isUserIgnored(target.toLowerCase())) {
					await messagesThrottle(() => say(`@${userName} ${target} does not partake in AI sweatlings.`));
					return;
				}

				const specifiedStyle = params[1] ?? null;
				const rawUserInputForCommand = params.join(" "); // Capture full user input for the command

				let imageResult: ImageGenerationResult;
				try {
					const metadata = { source: 'twitch_command', /* channel: broadcasterName, */ target: target, trigger: 'aisweatling_cmd' };
					// const theme = themeManager.getBroadcasterTheme(broadcasterName.toLowerCase()); // Old theme logic
					const theme = await botConfigManager.getCurrentBotTheme(); // New theme logic
					imageResult = await retryAsyncOperation(
						generateImage, MAX_RETRIES, target.toLowerCase(), target, /* broadcasterName.toLowerCase() REMOVED */
						'aisweatling_command', rawUserInputForCommand, theme ?? undefined, specifiedStyle, metadata
					);
				} catch (error: any) {
					imageResult = { success: false, message: error.message || 'Error in aisweatling command' };
				}

				if (!imageResult.success) {
					await messagesThrottle(() => say(truncate(`Sorry, @${userName}, I was unable to generate an image for ${target}. ${imageResult.message}`, 500)));
					return;
				}

				// generateImage now handles its own DB logging.
				// No need for imageDataStore.storeImageData(...) here.

				try {
					discordBot.user!.setActivity({ name: 'ImageGenerations', state: `🖼️ generating images`, type: ActivityType.Custom });
				} catch (error) {
					console.log('Discord error setting activity:', error);
				}

				for (const channelId of discordChannels) {
					const channel = discordBot.channels.cache.get(channelId) as TextChannel;
					if (channel && channel.isTextBased() && channel.isSendable()) {
						try {
							const sentMessage = await channel.send({
								content: `@${userName} requested generation for \`${target}\`. Here's the sweatling: ${imageResult.message}`,
							});
							if (imageResult.requestId) {
								await query('UPDATE image_generation_logs SET discord_message_id = $1 WHERE request_id = $2', [sentMessage.id, imageResult.requestId]);
								try {
									await sentMessage.react(env.DISCORD_UPVOTE_EMOJI || '👍');
									await sentMessage.react(env.DISCORD_DOWNVOTE_EMOJI || '👎');
								} catch (reactionError) {
									console.error('Error adding auto-reactions to aisweatling cmd image:', reactionError);
								}
							}
						} catch (error) {
							console.log(`Error sending aisweatling cmd image to Discord channel ${channelId}`, error);
						}
					}
				}
				await messagesThrottle(() => say(`@${userName} requested generation for @${target}. Here's the sweatling: ${imageResult.message}`));
			}),
			// ... other commands (settheme, deltheme, etc.) remain largely the same as they use their respective managers ...
			// Ensure all manager calls use lowercased keys where appropriate e.g. broadcasterName.toLowerCase()
			createBotCommand('settheme', async (params, { userName, broadcasterName, say }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) return; // broadcasterName still used for admin check
				if (params.length === 0) { await messagesThrottle(() => say(`@${userName} Please provide a theme.`)); return; }
				const themeToSet = params.join(' ');
				await botConfigManager.setCurrentBotTheme(themeToSet);
				await messagesThrottle(() => say(`@${userName} Global bot theme set to: ${themeToSet}`));
			}),
			createBotCommand('deltheme', async (_params, { userName, broadcasterName, say }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) return; // broadcasterName still used for admin check
				await botConfigManager.setCurrentBotTheme('');
				await messagesThrottle(() => say(`@${userName} Global bot theme has been cleared.`));
			}),
			createBotCommand('gettheme', async (_params, { userName, broadcasterName, say }) => { // broadcasterName still used for admin check (implicitly by isAdminOrBroadcaster)
				const theme = await botConfigManager.getCurrentBotTheme();
				await messagesThrottle(() => theme ? say(`@${userName} Current global bot theme: ${theme}`) : say(`@${userName} No global bot theme set.`));
			}),
			createBotCommand('setmeaning', async (params, { userName, broadcasterName, say }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) return;
				if (params.length < 2) { await messagesThrottle(() => say(`@${userName} Please provide a username and a meaning.`)); return; }
				const user = params[0].toLowerCase();
				const meaning = params.slice(1).join(' ');
				await meaningManager.setMeaning(user, meaning);
				await messagesThrottle(() => say(`@${userName} Meaning for ${params[0]} set.`));
			}),
			createBotCommand('delmeaning', async (params, { userName, broadcasterName, say }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) return;
				if (params.length !== 1) { await messagesThrottle(() => say(`@${userName} Please provide a username.`)); return; }
				const user = params[0].toLowerCase();
				const wasRemoved = await meaningManager.removeMeaning(user);
				await messagesThrottle(() => wasRemoved ? say(`@${userName} Meaning for ${params[0]} removed.`) : say(`@${userName} Meaning for ${params[0]} not found.`));
			}),
			createBotCommand('getmeaning', async (params, { userName, say }) => {
				if (params.length !== 1) { await messagesThrottle(() => say(`@${userName} Please provide a username.`)); return; }
				const user = params[0].toLowerCase();
				const meaning = meaningManager.getUserMeaning(user); // getUserMeaning itself handles if not found
				await messagesThrottle(() => say(`@${userName} ${params[0]} means '${meaning}' dnkNoted`));
			}),
			createBotCommand('noai', async (_params, { userName, say }) => {
				await ignoreListManager.addToIgnoreList(userName.toLowerCase());
				await messagesThrottle(() => say(`@${userName} You will no longer receive AI sweatlings`));
			}),
			createBotCommand('yesai', async (_params, { userName, say }) => {
				await ignoreListManager.removeFromIgnoreList(userName.toLowerCase());
				await messagesThrottle(() => say(`@${userName} You will now receive AI sweatlings`));
			}),
			createBotCommand('bangifter', async (params, { userName, broadcasterName, say }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) return;
				if (params.length !== 1) { await messagesThrottle(() => say(`@${userName} Please provide a username.`)); return; }
				const gifter = params[0].toLowerCase();
				await bannedGifterManager.addBannedGifter(broadcasterName.toLowerCase(), gifter);
				await messagesThrottle(() => say(`@${userName} Gifter ${params[0]} banned. Sub gifts from this user will be ignored.`));
			}),
			createBotCommand('unbangifter', async (params, { userName, broadcasterName, say }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) return;
				if (params.length !== 1) { await messagesThrottle(() => say(`@${userName} Please provide a username.`)); return; }
				const gifter = params[0].toLowerCase();
				const wasRemoved = await bannedGifterManager.removeBannedGifter(broadcasterName.toLowerCase(), gifter);
				await messagesThrottle(() => wasRemoved ? say(`@${userName} Gifter ${params[0]} unbanned.`) : say(`@${userName} Gifter ${params[0]} was not banned.`));
			}),
			createBotCommand('ping', async (_params, { userName, say }) => {
				if (userName.toLowerCase() !== 'partyhorst') return;
				await messagesThrottle(() => say(`@${userName} pong`));
			}),
			createBotCommand('say', async (params, { say, userName, broadcasterName }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) return;
				if (params.length === 0) return;
				await messagesThrottle(() => say(params.join(' ')));
			}),
			createBotCommand('uguu', async (_params, { say, userName, broadcasterName }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) return;
				await messagesThrottle(() => say(`!uguu`));
			}),
			createBotCommand('quack', async (_params, { say, userName, broadcasterName }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) return;
				await messagesThrottle(() => say(`!quack`));
			}),
			createBotCommand('myai', async (_params, { userName, say }) => {
				await messagesThrottle(() => say(`@${userName} Check your sweatlings at https://www.curvyspiderwife.com/user/${userName} or in Discord dnkLove`));
			}),
			createBotCommand('testall', async (params, { userName, broadcasterName, say }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) return;
				if (testGenerationState.isRunning) {
					await messagesThrottle(() => say(`@${userName} A test generation is already running. Use !canceltests to stop it.`));
					return;
				}
				if (params.length === 0) {
					await messagesThrottle(() => say(`@${userName} Please provide a username to test with.`));
					return;
				}
				const target = params[0].replace('@', '');
				const count = params.length > 1 ? parseInt(params[1], 10) : 1;

				if (isNaN(count) || count < 1) {
					await messagesThrottle(() => say(`@${userName} Please provide a valid number of images to generate.`));
					return;
				}

				const startTime = Date.now();
				testGenerationState.isRunning = true;
				testGenerationState.shouldCancel = false;
				const totalTasks = count * DALLE_TEMPLATES.length;
				await messagesThrottle(() => say(`@${userName} Starting test generation for ${target} with ${count} image(s) per style. Total images: ${totalTasks}`));

				let successCount = 0;
				let failureCount = 0;
				// const theme = themeManager.getBroadcasterTheme(broadcasterName.toLowerCase()); // Old
				const theme = await botConfigManager.getCurrentBotTheme(); // New
				const generationTasks = [];

				for (const template of DALLE_TEMPLATES) {
					for (let i = 0; i < count; i++) {
						if (testGenerationState.shouldCancel) break;
						const task = async () => {
							if (testGenerationState.shouldCancel) { console.log(`Skipping generation for ${template.keyword} (cancelled)`); return; }
							try {
								const metadata = { source: 'twitch_testall', channel: broadcasterName, target: target, trigger: 'testall_cmd', style: template.keyword };
								const imageResult = await retryAsyncOperation(
									generateImage, MAX_RETRIES, target.toLowerCase(), target, /* broadcasterName.toLowerCase() REMOVED */
									'testall_command', `Testall for ${target}, style ${template.keyword}`, theme ?? undefined, template.keyword, metadata
								);
								if (!imageResult.success) {
									failureCount++;
									await messagesThrottle(() => say(`@${userName} Failed to generate image for style ${template.keyword}. Error: ${imageResult.message}`));
									return;
								}
								successCount++;
								// Logging is handled by generateImage
								await Promise.all([
									messagesThrottle(() => say(`@${userName} Test image for style ${template.keyword}: ${imageResult.message}`)),
									...discordChannels.map(async (channelId) => {
										const channel = discordBot.channels.cache.get(channelId) as TextChannel;
										if (channel?.isTextBased() && channel.isSendable()) {
											const sentMessage = await channel.send({ content: `Test image for \`${target}\` using style ${template.keyword}: ${imageResult.message}` });
											if (imageResult.requestId) {
												await query('UPDATE image_generation_logs SET discord_message_id = $1 WHERE request_id = $2', [sentMessage.id, imageResult.requestId]);
												try {
													await sentMessage.react(env.DISCORD_UPVOTE_EMOJI || '👍');
													await sentMessage.react(env.DISCORD_DOWNVOTE_EMOJI || '👎');
												} catch (reactionError) { console.error('Error adding auto-reactions to testall image:', reactionError); }
											}
										}
									}),
								]);
							} catch (error: any) {
								failureCount++;
								console.error(`Error in testall generation task for ${target} with style ${template.keyword}:`, error);
								await messagesThrottle(() => say(`@${userName} Error generating image for style ${template.keyword}. ${error.message}`));
							}
						};
						generationTasks.push(task()); // Add promise to tasks array
					}
					if (testGenerationState.shouldCancel) break;
				}

				try {
					await Promise.all(generationTasks);
				} finally {
					testGenerationState.isRunning = false;
					const wasCancel = testGenerationState.shouldCancel;
					testGenerationState.shouldCancel = false; // Reset for next run
					const endTime = Date.now();
					const totalSeconds = ((endTime - startTime) / 1000).toFixed(1);
					const summary = `Test generation ${wasCancel ? 'cancelled' : 'complete'}. Success: ${successCount}, Failures: ${failureCount}, Total: ${successCount + failureCount}/${totalTasks}. Time: ${totalSeconds}s`;
					await Promise.all([
						messagesThrottle(() => say(`@${userName} ${summary}`)),
						...discordChannels.map(channelId => {
							const channel = discordBot.channels.cache.get(channelId) as TextChannel;
							if (channel?.isTextBased() && channel.isSendable()) {
								return channel.send({ content: summary });
							}
							return Promise.resolve();
						}),
					]);
				}
			}),
			createBotCommand('canceltests', async (_params, { userName, broadcasterName, say }) => {
				if (!isAdminOrBroadcaster(userName, broadcasterName, twitchAdmins)) return;
				if (!testGenerationState.isRunning) {
					await messagesThrottle(() => say(`@${userName} No test generation is currently running.`));
					return;
				}
				testGenerationState.shouldCancel = true;
				await messagesThrottle(() => say(`@${userName} Cancelling test generation after current tasks complete...`));
			}),
		];

		const twitchBot = new Bot({ authProvider, channels: Array.from(twitchChannels), commands });

		twitchBot.onDisconnect((manually, reason) => console.log(`[ERROR] Disconnected from Twitch: ${manually} ${reason}`));
		twitchBot.onConnect(() => console.log(`Connected to Twitch chat server`));
		twitchBot.onJoin(({ broadcasterName }) => console.log(`Joined Twitch channel ${broadcasterName}`));

		// Simplified event handlers for Twitch events
		const twitchEventCommonHandler = (eventTrigger: string, broadcasterName: string, eventUserName: string, eventUserDisplayName: string, isGifting = false) => {
			console.log(eventTrigger, broadcasterName, eventUserName, eventUserDisplayName);
			if (isGifting && eventUserName && bannedGifterManager.isGifterBanned(broadcasterName.toLowerCase(), eventUserName.toLowerCase())) {
				console.log(`Gifter ${eventUserName} is banned for ${broadcasterName}, not generating image for this gift event.`);
				return;
			}
			// For sub gifts, the image is for the recipient (userName), check if gifter is banned applies to the gifter, not recipient.
			// For community subs, the image is for the gifter.
			handleEventAndSendImageMessage(twitchBot, discordBot, {
				broadcasterName,
				userName: eventUserName,
				userDisplayName: eventUserDisplayName,
				isGifting,
				triggerEvent: eventTrigger,
			});
		};

		twitchBot.onSub(({ broadcasterName, userName, userDisplayName }) => twitchEventCommonHandler('sub', broadcasterName, userName, userDisplayName));
		twitchBot.onResub(({ broadcasterName, userName, userDisplayName }) => twitchEventCommonHandler('resub', broadcasterName, userName, userDisplayName));
		twitchBot.onGiftPaidUpgrade(({ broadcasterName, userName, userDisplayName }) => twitchEventCommonHandler('gift_upgrade', broadcasterName, userName, userDisplayName));
		twitchBot.onPrimePaidUpgrade(({ broadcasterName, userName, userDisplayName }) => twitchEventCommonHandler('prime_upgrade', broadcasterName, userName, userDisplayName));

		twitchBot.onStandardPayForward(({ broadcasterName, gifterName, gifterDisplayName }) =>
			twitchEventCommonHandler('std_pay_fwd', broadcasterName, gifterName!, gifterDisplayName!, true)
		);
		twitchBot.onCommunityPayForward(({ broadcasterName, gifterName, gifterDisplayName }) =>
			twitchEventCommonHandler('comm_pay_fwd', broadcasterName, gifterName!, gifterDisplayName!, true)
		);
		twitchBot.onCommunitySub(({ broadcasterName, gifterName, gifterDisplayName, count }) => {
			// Image for the gifter
			const effectiveGifterName = gifterName || 'Anonymous';
			const effectiveGifterDisplayName = gifterDisplayName || 'Anonymous';
			console.log('onCommunitySub', broadcasterName, effectiveGifterName, effectiveGifterDisplayName, `Count: ${count}`);
			if (gifterName && bannedGifterManager.isGifterBanned(broadcasterName.toLowerCase(), gifterName.toLowerCase())) {
				console.log(`Gifter ${gifterName} is banned for ${broadcasterName}, not generating image for community sub.`);
				return;
			}
			handleEventAndSendImageMessage(twitchBot, discordBot, {
				broadcasterName, userName: effectiveGifterName, userDisplayName: effectiveGifterDisplayName, isGifting: true, triggerEvent: 'community_sub'
			});
		});
		twitchBot.onSubGift(({ broadcasterName, userName, userDisplayName, gifterName, gifterDisplayName }) => {
			// Image for the recipient (userName)
			console.log('onSubGift', broadcasterName, `Recipient: ${userName}`, `Gifter: ${gifterName || 'anonymous'}`);
			if (!gifterName || bannedGifterManager.isGifterBanned(broadcasterName.toLowerCase(), gifterName.toLowerCase())) {
				console.log(`Gifter ${gifterName || 'anonymous'} for sub gift to ${userName} is banned or anonymous, not generating image for recipient.`);
				return;
			}
			handleEventAndSendImageMessage(twitchBot, discordBot, {
				broadcasterName, userName, userDisplayName, isGifting: false, triggerEvent: `sub_gift_from_${gifterName}` // Recipient gets image
			});
		});


	} catch (error: unknown) {
		if (error instanceof InvalidTokenError) {
			console.error('!!! CRITICAL: Invalid Twitch tokens. Please check configuration and re-authenticate if necessary.');
		} else if (error instanceof Error) {
			console.error('!!! CRITICAL ERROR in main function:', error.message, error.stack);
		} else {
			console.error('!!! CRITICAL UNKNOWN ERROR in main function:', error);
		}
		// Consider process.exit(1) for critical startup failures if appropriate
	}
}


// --- Initial Setup and Main Execution ---
async function initializeApp() {
	try {
		// Setup console log to also write to file
		const originalLog = console.log;
		console.log = (...args: unknown[]) => {
			const now = new Date().toISOString();
			const message = args.map(arg => typeof arg === 'string' ? arg : JSON.stringify(arg)).join(' ');
			fsPromises.appendFile(logFilePath, `[${now}] ${message}\n`).catch(err => originalLog("Error writing to log file:", err));
			originalLog(`[${now}]`, ...args);
		};
		// Ensure data directory and log file exist (though ensureFileExists was removed for JSONs)
        const dataDir = path.join(await getAppRootDir(), 'data');
        if (!await fsPromises.access(dataDir).then(() => true).catch(() => false)) {
            await fsPromises.mkdir(dataDir, { recursive: true });
        }
        await fsPromises.writeFile(logFilePath, '', { flag: 'a' }); // Touch log file

		console.log('Application starting...');
		console.log(`Using OpenAI model: ${env.OPENAI_MODEL}`);
		console.log('Twitch admins:', Array.from(twitchAdmins).join(', '));
		console.log('Target Twitch channels:', Array.from(twitchChannels).join(', '));
		console.log('Target Discord channels for announcements:', discordChannels.join(', '));
		console.log(`Discord Admin User ID: ${discordAdmin}`);

		await main();
	} catch (error: unknown) {
		// Fallback console.error if custom console.log failed or error is very early
		const conErr = console.error || console.log;
		if (error instanceof Error) {
			conErr('!!! FATAL INITIALIZATION ERROR:', error.message, error.stack);
		} else {
			conErr('!!! FATAL UNKNOWN INITIALIZATION ERROR:', error);
		}
		process.exit(1); // Exit if critical initialization fails
	}
}

initializeApp();
