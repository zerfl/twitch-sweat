import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFile } from 'fs/promises';
import path from 'path';
import { BannedGifterManager } from '../../src/managers/BannedGifterManager';
import { cleanupTempDir, createTempDir } from '../helpers/tempDir';

describe('BannedGifterManager', () => {
	let manager: BannedGifterManager;
	let dirPath = '';

	beforeEach(async () => {
		dirPath = await createTempDir('banned-gifter-manager-');
		manager = new BannedGifterManager(path.join(dirPath, 'bannedGifters.json'));
		await manager.loadBannedGifters();
	});

	afterEach(async () => {
		await cleanupTempDir(dirPath);
	});

	it('adds banned gifters per broadcaster', async () => {
		await manager.addBannedGifter('Streamer', 'GifterA');
		expect(manager.isGifterBanned('streamer', 'giftera')).toBe(true);
		expect(manager.isGifterBanned('other', 'giftera')).toBe(false);
	});

	it('removes banned gifters', async () => {
		await manager.addBannedGifter('Streamer', 'GifterA');
		const removed = await manager.removeBannedGifter('streamer', 'GIFTERA');
		expect(removed).toBe(true);
		expect(manager.isGifterBanned('streamer', 'giftera')).toBe(false);
	});

	it('loads existing banned gifters from disk with normalized casing', async () => {
		await writeFile(
			path.join(dirPath, 'bannedGifters.json'),
			JSON.stringify({ StreamerX: ['GiftOne', 'GiftTwo'] }),
			'utf-8',
		);
		await manager.loadBannedGifters();

		expect(manager.isGifterBanned('streamerx', 'giftone')).toBe(true);
		expect(manager.isGifterBanned('streamerx', 'gifttwo')).toBe(true);
	});

	it('returns false when removing missing gifter and exposes defensive map copy', async () => {
		expect(await manager.removeBannedGifter('streamer', 'nobody')).toBe(false);
		const snapshot = manager.getMap();
		snapshot.set('streamer', ['mutated']);
		expect(manager.isGifterBanned('streamer', 'mutated')).toBe(false);
	});
});
