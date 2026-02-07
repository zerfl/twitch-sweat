import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
	type RefreshHandler = (_userId: string, _tokenData: unknown) => Promise<void> | void;
	type RefreshFailureHandler = (_error: unknown) => void;

	let addUserError: Error | null = null;
	const authInstances: MockRefreshingAuthProvider[] = [];
	const botInstances: MockBot[] = [];

	class MockInvalidTokenError extends Error {}

	class MockRefreshingAuthProvider {
		refreshHandler: RefreshHandler | null = null;
		refreshFailureHandler: RefreshFailureHandler | null = null;
		lastToken: unknown;
		lastScopes: unknown;

		constructor(_args: unknown) {
			authInstances.push(this);
		}

		onRefresh(handler: RefreshHandler): void {
			this.refreshHandler = handler;
		}

		onRefreshFailure(handler: RefreshFailureHandler): void {
			this.refreshFailureHandler = handler;
		}

		async addUserForToken(token: unknown, scopes: unknown): Promise<void> {
			this.lastToken = token;
			this.lastScopes = scopes;
			if (addUserError) {
				throw addUserError;
			}
		}
	}

	class MockBot {
		handlers: Record<string, (...args: unknown[]) => unknown> = {};
		sayCalls: Array<{ channel: string; message: string }> = [];
		leaveCalls: string[] = [];

		constructor(_args: unknown) {
			botInstances.push(this);
		}

		onDisconnect(handler: (...args: unknown[]) => unknown): void {
			this.handlers.onDisconnect = handler;
		}
		onConnect(handler: (...args: unknown[]) => unknown): void {
			this.handlers.onConnect = handler;
		}
		onJoin(handler: (...args: unknown[]) => unknown): void {
			this.handlers.onJoin = handler;
		}
		onSub(handler: (...args: unknown[]) => unknown): void {
			this.handlers.onSub = handler;
		}
		onResub(handler: (...args: unknown[]) => unknown): void {
			this.handlers.onResub = handler;
		}
		onGiftPaidUpgrade(handler: (...args: unknown[]) => unknown): void {
			this.handlers.onGiftPaidUpgrade = handler;
		}
		onPrimePaidUpgrade(handler: (...args: unknown[]) => unknown): void {
			this.handlers.onPrimePaidUpgrade = handler;
		}
		onStandardPayForward(handler: (...args: unknown[]) => unknown): void {
			this.handlers.onStandardPayForward = handler;
		}
		onCommunityPayForward(handler: (...args: unknown[]) => unknown): void {
			this.handlers.onCommunityPayForward = handler;
		}
		onCommunitySub(handler: (...args: unknown[]) => unknown): void {
			this.handlers.onCommunitySub = handler;
		}
		onSubGift(handler: (...args: unknown[]) => unknown): void {
			this.handlers.onSubGift = handler;
		}

		async say(channel: string, message: string): Promise<void> {
			this.sayCalls.push({ channel, message });
		}

		leave(channel: string): void {
			this.leaveCalls.push(channel);
		}
	}

	return {
		getAddUserError: (): Error | null => addUserError,
		setAddUserError: (error: Error | null): void => {
			addUserError = error;
		},
		authInstances,
		botInstances,
		MockInvalidTokenError,
		MockRefreshingAuthProvider,
		MockBot,
	};
});

vi.mock('@twurple/auth', () => {
	return {
		InvalidTokenError: mocks.MockInvalidTokenError,
		RefreshingAuthProvider: mocks.MockRefreshingAuthProvider,
	};
});

vi.mock('@twurple/easy-bot', () => {
	return {
		Bot: mocks.MockBot,
	};
});

import { TwitchBotAdapter } from '../../src/adapters/twitch/TwitchBotAdapter';

describe('TwitchBotAdapter lifecycle', () => {
	beforeEach(() => {
		mocks.setAddUserError(null);
		mocks.authInstances.length = 0;
		mocks.botInstances.length = 0;
	});

	it('is safe to stop before start and rejects sendTwitch before start', async () => {
		const adapter = new TwitchBotAdapter({
			broadcasterName: 'streamer',
			clientId: 'client-id',
			clientSecret: 'client-secret',
			accessToken: 'access',
			refreshToken: 'refresh',
			tokenRepository: {
				getLatestToken: vi.fn(async () => null),
				upsertToken: vi.fn(async () => undefined),
			},
			preferenceRepository: {
				isBannedGifter: vi.fn(async () => false),
			} as never,
			handleTwitchEventUseCase: {
				handleSubscriptionEvent: vi.fn(async () => undefined),
			} as never,
			commands: [],
		});

		await adapter.stop();
		await expect(adapter.sendTwitch('hello')).rejects.toThrow('Twitch bot is not started');
	});

	it('starts with stored token, records refreshes, routes chat/events, and stops cleanly', async () => {
		const upsertToken = vi.fn(async () => undefined);
		const handleSubscriptionEvent = vi.fn(async () => undefined);
		const storedToken = {
			accessToken: 'stored-access',
			refreshToken: 'stored-refresh',
			expiresIn: 10,
			obtainmentTimestamp: 1,
			scope: ['chat:edit', 'chat:read'],
		};
		const adapter = new TwitchBotAdapter({
			broadcasterName: 'streamer',
			clientId: 'client-id',
			clientSecret: 'client-secret',
			accessToken: 'access',
			refreshToken: 'refresh',
			tokenRepository: {
				getLatestToken: vi.fn(async () => storedToken),
				upsertToken,
			},
			preferenceRepository: {
				isBannedGifter: vi.fn(async () => false),
			} as never,
			handleTwitchEventUseCase: {
				handleSubscriptionEvent,
			} as never,
			commands: [],
		});

		await adapter.start();

		expect(mocks.authInstances[0]?.lastToken).toEqual(storedToken);
		expect(mocks.authInstances[0]?.lastScopes).toEqual(['chat']);

		const refreshed = {
			accessToken: 'new-access',
			refreshToken: 'new-refresh',
			expiresIn: 20,
			obtainmentTimestamp: 2,
			scope: ['chat:edit', 'chat:read'],
		};
		await mocks.authInstances[0]?.refreshHandler?.('user', refreshed);
		expect(upsertToken).toHaveBeenCalledWith(refreshed);
		mocks.authInstances[0]?.refreshFailureHandler?.(new Error('refresh failed'));

		await adapter.sendTwitch('hello');
		expect(mocks.botInstances[0]?.sayCalls).toEqual([{ channel: 'streamer', message: 'hello' }]);

		await mocks.botInstances[0]?.handlers.onSub?.({ userName: 'u1', userDisplayName: 'U1' });
		await mocks.botInstances[0]?.handlers.onCommunitySub?.({ gifterName: undefined, gifterDisplayName: undefined });
		expect(handleSubscriptionEvent).toHaveBeenCalledWith({ trigger: 'onSub', userName: 'u1', userDisplayName: 'U1' });
		expect(handleSubscriptionEvent).toHaveBeenCalledWith({
			trigger: 'onCommunitySub',
			userName: 'Anonymous',
			userDisplayName: 'Anonymous',
			isGifting: true,
		});

		await adapter.sendDiscordBroadcast('noop');
		await adapter.stop();
		expect(mocks.botInstances[0]?.leaveCalls).toEqual(['streamer']);
	});

	it('maps invalid token errors to a clear message', async () => {
		mocks.setAddUserError(new mocks.MockInvalidTokenError('bad token'));
		const adapter = new TwitchBotAdapter({
			broadcasterName: 'streamer',
			clientId: 'client-id',
			clientSecret: 'client-secret',
			accessToken: 'access',
			refreshToken: 'refresh',
			tokenRepository: {
				getLatestToken: vi.fn(async () => null),
				upsertToken: vi.fn(async () => undefined),
			},
			preferenceRepository: {
				isBannedGifter: vi.fn(async () => false),
			} as never,
			handleTwitchEventUseCase: {
				handleSubscriptionEvent: vi.fn(async () => undefined),
			} as never,
			commands: [],
		});

		await expect(adapter.start()).rejects.toThrow('Invalid Twitch tokens, please check your environment variables');
	});
});
