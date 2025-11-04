/**
 * Mock Twitch Bot for testing
 *
 * Simulates @twurple/easy-bot Bot without connecting to Twitch.
 */

import type { Bot } from '@twurple/easy-bot';

type EventCallback = (...args: any[]) => void | Promise<void>;

export class MockTwitchBot {
	private eventHandlers: Map<string, EventCallback[]> = new Map();
	private messages: Array<{ channel: string; message: string }> = [];
	public isConnected = false;

	// Bot lifecycle
	async connect(): Promise<void> {
		this.isConnected = true;
	}

	async disconnect(): Promise<void> {
		this.isConnected = false;
	}

	// Event registration
	onConnect(callback: EventCallback): void {
		this.registerHandler('connect', callback);
	}

	onDisconnect(callback: EventCallback): void {
		this.registerHandler('disconnect', callback);
	}

	onJoin(callback: EventCallback): void {
		this.registerHandler('join', callback);
	}

	onSub(callback: EventCallback): void {
		this.registerHandler('sub', callback);
	}

	onResub(callback: EventCallback): void {
		this.registerHandler('resub', callback);
	}

	onSubGift(callback: EventCallback): void {
		this.registerHandler('subgift', callback);
	}

	onCommunitySub(callback: EventCallback): void {
		this.registerHandler('communitysub', callback);
	}

	onGiftPaidUpgrade(callback: EventCallback): void {
		this.registerHandler('giftpaidupgrade', callback);
	}

	onPrimePaidUpgrade(callback: EventCallback): void {
		this.registerHandler('primepaidupgrade', callback);
	}

	onStandardPayForward(callback: EventCallback): void {
		this.registerHandler('standardpayforward', callback);
	}

	onCommunityPayForward(callback: EventCallback): void {
		this.registerHandler('communitypayforward', callback);
	}

	// Message sending
	async say(channel: string, message: string): Promise<void> {
		this.messages.push({ channel, message });
	}

	// Test helpers
	private registerHandler(event: string, callback: EventCallback): void {
		if (!this.eventHandlers.has(event)) {
			this.eventHandlers.set(event, []);
		}
		this.eventHandlers.get(event)!.push(callback);
	}

	async emitEvent(event: string, data: any): Promise<void> {
		const handlers = this.eventHandlers.get(event) || [];
		for (const handler of handlers) {
			await handler(data);
		}
	}

	getMessages(): Array<{ channel: string; message: string }> {
		return [...this.messages];
	}

	clearMessages(): void {
		this.messages = [];
	}

	getLastMessage(): { channel: string; message: string } | undefined {
		return this.messages[this.messages.length - 1];
	}

	getMessagesForChannel(channel: string): string[] {
		return this.messages
			.filter(msg => msg.channel === channel)
			.map(msg => msg.message);
	}
}

/**
 * Create a mock Twitch bot instance
 */
export function createMockTwitchBot(): MockTwitchBot {
	return new MockTwitchBot();
}

/**
 * Mock bot that throws errors (for error testing)
 */
export class FailingMockTwitchBot extends MockTwitchBot {
	override async say(): Promise<void> {
		throw new Error('Failed to send message to Twitch');
	}
}
