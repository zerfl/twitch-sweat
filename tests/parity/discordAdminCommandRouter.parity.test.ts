import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { DiscordAdminCommandRouter } from '../../src/adapters/discord/DiscordAdminCommandRouter';

type Golden = {
	discordAdmin: Record<string, string>;
};

function loadGolden(): Golden {
	const file = new URL('./golden/typed-baseline.json', import.meta.url);
	return JSON.parse(readFileSync(file, 'utf-8')) as Golden;
}

describe('typed baseline parity: discord admin command router', () => {
	const golden = loadGolden();

	it('matches !announce and !generateimage behavior with exact text and order', async () => {
		const callOrder: string[] = [];
		const enqueueGenerateImageRequest = vi.fn(async ({ targetUser }: { targetUser: string }) => {
			callOrder.push(`enqueue:${targetUser}`);
			return `job-${targetUser}`;
		});
		const sendBroadcast = vi.fn(async (message: string) => {
			callOrder.push(`broadcast:${message}`);
		});
		const replies: string[] = [];

		const router = new DiscordAdminCommandRouter({
			handleDiscordAdminCommandUseCase: { enqueueGenerateImageRequest } as never,
			sendBroadcast,
		});

		await router.handleMessage('!announce hello chat', 'dm-1', async (message: string) => {
			callOrder.push(`reply:${message}`);
			replies.push(message);
		});
		await router.handleMessage('!generateimage alpha beta', 'dm-1', async (message: string) => {
			callOrder.push(`reply:${message}`);
			replies.push(message);
		});

		expect(replies).toEqual([golden.discordAdmin.announcing, golden.discordAdmin.queuedTwo]);
		expect(callOrder).toEqual([
			`reply:${golden.discordAdmin.announcing}`,
			'broadcast:hello chat',
			'enqueue:alpha',
			'enqueue:beta',
			`reply:${golden.discordAdmin.queuedTwo}`,
		]);
	});

	it('matches validation and unknown-command text', async () => {
		const replies: string[] = [];
		const router = new DiscordAdminCommandRouter({
			handleDiscordAdminCommandUseCase: { enqueueGenerateImageRequest: vi.fn() } as never,
			sendBroadcast: vi.fn(async () => undefined),
		});

		await router.handleMessage('!announce', 'dm-1', async (message: string) => {
			replies.push(message);
		});
		await router.handleMessage('!generateimage', 'dm-1', async (message: string) => {
			replies.push(message);
		});
		await router.handleMessage('!wat', 'dm-1', async (message: string) => {
			replies.push(message);
		});

		expect(replies).toEqual([
			golden.discordAdmin.needAnnouncement,
			golden.discordAdmin.needGenerateTargets,
			golden.discordAdmin.unknownCommand,
		]);
	});
});
