import { ActivityType, Client as DiscordClient, Events, GatewayIntentBits, Partials, type TextBasedChannel } from 'discord.js';
import { discordDmNotMonitored } from '../../domain/policies/MessageTemplatePolicy';
import type { BroadcastNotifierContract, ChannelNotifierContract } from '../../application/contracts';
import type { DiscordAdminCommandRouter } from './DiscordAdminCommandRouter';

type SendableTextChannel = TextBasedChannel & {
	send: (payload: { content: string }) => Promise<unknown>;
};

function isSendableTextChannel(channel: TextBasedChannel): channel is SendableTextChannel {
	return typeof (channel as { send?: unknown }).send === 'function';
}

interface DiscordBotAdapterDeps {
	discordBotToken: string;
	discordAdminUserId: string;
	discordChannels: string[];
	discordAdminCommandRouter: DiscordAdminCommandRouter;
}

export class DiscordBotAdapter implements BroadcastNotifierContract, ChannelNotifierContract {
	private readonly client = new DiscordClient({
		intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
		partials: [Partials.Channel, Partials.Message],
		presence: {
			activities: [
				{
					name: 'ImageGenerations',
					state: '🖼️ generating images',
					type: ActivityType.Custom,
				},
			],
			status: 'online',
		},
	});

	constructor(private readonly deps: DiscordBotAdapterDeps) {}

	async start(): Promise<void> {
		this.registerEventHandlers();
		await this.client.login(this.deps.discordBotToken);
	}

	async stop(): Promise<void> {
		await this.client.destroy();
	}

	async sendTwitch(_message: string): Promise<void> {
		// Intentionally unsupported here. Twitch adapter implements twitch broadcast.
	}

	async sendDiscordBroadcast(message: string): Promise<void> {
		for (const channelId of this.deps.discordChannels) {
			await this.sendDiscordChannel(channelId, message);
		}
	}

	async sendDiscordChannel(channelId: string, message: string): Promise<void> {
		const channel = await this.resolveTextChannel(channelId);
		if (!channel) {
			throw new Error(`Discord channel not found: ${channelId}`);
		}
		await channel.send({ content: message });
	}

	private registerEventHandlers(): void {
		this.client.on(Events.InteractionCreate, async (interaction) => {
			if (!interaction.isButton()) {
				return;
			}
			if (interaction.customId === 'primary') {
				await interaction.reply(`Button clicked: ${interaction.user.displayName}`);
			}
		});

		this.client.on(Events.ClientReady, async () => {
			console.log('Discord bot logged in.');
			try {
				const admin =
					this.client.users.cache.get(this.deps.discordAdminUserId) ??
					(await this.client.users.fetch(this.deps.discordAdminUserId));
				await admin.createDM();
				console.log('Discord admin channel ready');
			} catch (error) {
				console.log('Discord error', error);
			}
		});

		this.client.on(Events.MessageCreate, async (message) => {
			if (message.guild !== null) {
				return;
			}
			if (message.author.id === this.client.user?.id) {
				return;
			}

			const admin =
				this.client.users.cache.get(this.deps.discordAdminUserId) ??
				(await this.client.users.fetch(this.deps.discordAdminUserId));
			if (message.author.id !== this.deps.discordAdminUserId) {
				await message.reply(discordDmNotMonitored(String(admin)));
				return;
			}

			await this.deps.discordAdminCommandRouter.handleMessage(message.content, message.channel.id, async (response) => {
				await message.reply(response);
			});
		});
	}

	private async resolveTextChannel(channelId: string): Promise<SendableTextChannel | null> {
		const cached = this.client.channels.cache.get(channelId);
		if (cached && cached.isTextBased() && cached.isSendable() && isSendableTextChannel(cached)) {
			return cached;
		}
		try {
			const fetched = await this.client.channels.fetch(channelId);
			if (fetched && fetched.isTextBased() && fetched.isSendable() && isSendableTextChannel(fetched)) {
				return fetched;
			}
		} catch (error) {
			console.log(`Error resolving Discord channel ${channelId}`, error);
		}
		return null;
	}
}
