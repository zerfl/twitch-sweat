import { describe, expect, it, vi } from 'vitest';
import { TwitchBotAdapter } from '../../src/adapters/twitch/TwitchBotAdapter';

type AnyHandler = (payload: Record<string, unknown>) => void | Promise<void>;

class FakeBot {
	handlers: Record<string, AnyHandler> = {};

	onDisconnect(handler: AnyHandler): void {
		this.handlers.onDisconnect = handler;
	}
	onConnect(handler: AnyHandler): void {
		this.handlers.onConnect = handler;
	}
	onJoin(handler: AnyHandler): void {
		this.handlers.onJoin = handler;
	}
	onSub(handler: AnyHandler): void {
		this.handlers.onSub = handler;
	}
	onResub(handler: AnyHandler): void {
		this.handlers.onResub = handler;
	}
	onGiftPaidUpgrade(handler: AnyHandler): void {
		this.handlers.onGiftPaidUpgrade = handler;
	}
	onPrimePaidUpgrade(handler: AnyHandler): void {
		this.handlers.onPrimePaidUpgrade = handler;
	}
	onStandardPayForward(handler: AnyHandler): void {
		this.handlers.onStandardPayForward = handler;
	}
	onCommunityPayForward(handler: AnyHandler): void {
		this.handlers.onCommunityPayForward = handler;
	}
	onCommunitySub(handler: AnyHandler): void {
		this.handlers.onCommunitySub = handler;
	}
	onSubGift(handler: AnyHandler): void {
		this.handlers.onSubGift = handler;
	}
}

function createFixture() {
	const handleSubscriptionEvent = vi.fn(async () => undefined);
	const preferenceRepository = {
		isBannedGifter: vi.fn(async () => false),
	};

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
		preferenceRepository: preferenceRepository as never,
		handleTwitchEventUseCase: { handleSubscriptionEvent } as never,
		commands: [],
	});
	const fakeBot = new FakeBot();
	(adapter as unknown as { registerEvents: (bot: FakeBot) => void }).registerEvents(fakeBot);

	return { fakeBot, handleSubscriptionEvent, preferenceRepository };
}

describe('typed baseline parity: twitch event adapter routing', () => {
	it('maps direct event handlers to the expected trigger payloads', async () => {
		const fixture = createFixture();

		await fixture.fakeBot.handlers.onSub?.({ userName: 'u1', userDisplayName: 'U1' });
		await fixture.fakeBot.handlers.onResub?.({ userName: 'u2', userDisplayName: 'U2' });
		await fixture.fakeBot.handlers.onGiftPaidUpgrade?.({ userName: 'u3', userDisplayName: 'U3' });
		await fixture.fakeBot.handlers.onPrimePaidUpgrade?.({ userName: 'u4', userDisplayName: 'U4' });
		await fixture.fakeBot.handlers.onStandardPayForward?.({ gifterName: 'g1', gifterDisplayName: 'G1' });
		await fixture.fakeBot.handlers.onCommunityPayForward?.({ gifterName: 'g2', gifterDisplayName: 'G2' });

		expect(fixture.handleSubscriptionEvent.mock.calls).toEqual([
			[{ trigger: 'onSub', userName: 'u1', userDisplayName: 'U1' }],
			[{ trigger: 'onResub', userName: 'u2', userDisplayName: 'U2' }],
			[{ trigger: 'onGiftPaidUpgrade', userName: 'u3', userDisplayName: 'U3' }],
			[{ trigger: 'onPrimePaidUpgrade', userName: 'u4', userDisplayName: 'U4' }],
			[{ trigger: 'onStandardPayForward', userName: 'g1', userDisplayName: 'G1', isGifting: true }],
			[{ trigger: 'onCommunityPayForward', userName: 'g2', userDisplayName: 'G2', isGifting: true }],
		]);
	});

	it('keeps community-sub and subgift banned/anonymous branches aligned with baseline behavior', async () => {
		const fixture = createFixture();

		fixture.preferenceRepository.isBannedGifter.mockResolvedValueOnce(true);
		await fixture.fakeBot.handlers.onCommunitySub?.({ gifterName: 'bad', gifterDisplayName: 'Bad' });
		expect(fixture.handleSubscriptionEvent).not.toHaveBeenCalled();

		await fixture.fakeBot.handlers.onCommunitySub?.({ gifterName: undefined, gifterDisplayName: undefined });
		expect(fixture.handleSubscriptionEvent).toHaveBeenCalledWith({
			trigger: 'onCommunitySub',
			userName: 'Anonymous',
			userDisplayName: 'Anonymous',
			isGifting: true,
		});

		fixture.handleSubscriptionEvent.mockClear();
		await fixture.fakeBot.handlers.onSubGift?.({ userName: 'receiver', userDisplayName: 'Receiver', gifterName: undefined });
		expect(fixture.handleSubscriptionEvent).not.toHaveBeenCalled();

		fixture.preferenceRepository.isBannedGifter.mockResolvedValueOnce(true);
		await fixture.fakeBot.handlers.onSubGift?.({ userName: 'receiver', userDisplayName: 'Receiver', gifterName: 'bad' });
		expect(fixture.handleSubscriptionEvent).not.toHaveBeenCalled();

		fixture.preferenceRepository.isBannedGifter.mockResolvedValueOnce(false);
		await fixture.fakeBot.handlers.onSubGift?.({ userName: 'receiver', userDisplayName: 'Receiver', gifterName: 'ok' });
		expect(fixture.handleSubscriptionEvent).toHaveBeenCalledWith({
			trigger: 'onSubGift',
			userName: 'receiver',
			userDisplayName: 'Receiver',
		});
	});
});
