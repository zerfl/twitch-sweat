/**
 * Mock Discord Bot for testing
 *
 * Simulates discord.js Client without connecting to Discord.
 */

import type { Client as DiscordClient } from 'discord.js';

type EventCallback = (...args: any[]) => void | Promise<void>;

interface MockChannel {
	id: string;
	name: string;
	isTextBased: () => boolean;
	isSendable: () => boolean;
	send: (message: any) => Promise<void>;
	messages: any[];
}

export class MockDiscordBot {
	private eventHandlers: Map<string, EventCallback[]> = new Map();
	private channelsMap: Map<string, MockChannel> = new Map();
	public isReady = false;
	public user = {
		id: 'mock-bot-id',
		displayName: 'MockBot',
		setActivity: async (activity: any) => { /* mock */ }
	};

	public channels = {
		cache: {
			get: (channelId: string): MockChannel | undefined => {
				return this.channelsMap.get(channelId);
			}
		}
	};

	public users = {
		cache: {
			get: (userId: string): any => {
				return {
					id: userId,
					displayName: 'MockUser',
					createDM: async () => { /* mock */ }
				};
			}
		},
		fetch: async (userId: string): Promise<any> => {
			return {
				id: userId,
				displayName: 'MockUser',
				createDM: async () => { /* mock */ }
			};
		}
	};

	// Bot lifecycle
	async login(token: string): Promise<string> {
		this.isReady = true;
		await this.emitEvent('ready', undefined);
		return token;
	}

	async destroy(): Promise<void> {
		this.isReady = false;
	}

	// Event registration
	on(event: string, callback: EventCallback): void {
		if (!this.eventHandlers.has(event)) {
			this.eventHandlers.set(event, []);
		}
		this.eventHandlers.get(event)!.push(callback);
	}

	// Test helpers
	async emitEvent(event: string, data: any): Promise<void> {
		const handlers = this.eventHandlers.get(event) || [];
		for (const handler of handlers) {
			await handler(data);
		}
	}

	addMockChannel(channelId: string, name: string = 'mock-channel'): MockChannel {
		const messages: any[] = [];
		const channel: MockChannel = {
			id: channelId,
			name: name,
			isTextBased: () => true,
			isSendable: () => true,
			send: async (message: any) => {
				messages.push(message);
			},
			messages: messages
		};
		this.channelsMap.set(channelId, channel);
		return channel;
	}

	getMockChannel(channelId: string): MockChannel | undefined {
		return this.channelsMap.get(channelId);
	}

	getChannelMessages(channelId: string): any[] {
		const channel = this.channelsMap.get(channelId);
		return channel ? channel.messages : [];
	}

	clearChannelMessages(channelId: string): void {
		const channel = this.channelsMap.get(channelId);
		if (channel) {
			channel.messages = [];
		}
	}
}

/**
 * Create a mock Discord bot instance
 */
export function createMockDiscordBot(): MockDiscordBot {
	const bot = new MockDiscordBot();
	// Add a default channel for testing
	bot.addMockChannel('default-channel-id', 'general');
	return bot;
}

/**
 * Mock bot that throws errors (for error testing)
 */
export class FailingMockDiscordBot extends MockDiscordBot {
	override async login(): Promise<string> {
		throw new Error('Failed to connect to Discord');
	}
}
