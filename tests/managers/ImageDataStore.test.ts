import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'path';
import { readFile, writeFile } from 'fs/promises';
import { ImageDataStore } from '../../src/managers/ImageDataStore';
import { cleanupTempDir, createTempDir } from '../helpers/tempDir';

describe('ImageDataStore', () => {
	let dataStore: ImageDataStore;
	let filePath = '';
	let dirPath = '';

	beforeEach(async () => {
		dirPath = await createTempDir('image-store-');
		filePath = path.join(dirPath, 'images.json');
		dataStore = new ImageDataStore(filePath);
	});

	afterEach(async () => {
		await cleanupTempDir(dirPath);
	});

	it('stores image payload and returns broadcaster image count', async () => {
		const count = await dataStore.storeImageData('Streamer', 'UserA', {
			image: 'https://example.com/a.png',
			analysis: 'analysis',
			prompt: 'prompt',
			date: '2026-02-07T00:00:00.000Z',
		});

		expect(count).toBe(1);

		const content = JSON.parse(await readFile(filePath, 'utf-8')) as Record<string, Record<string, unknown[]>>;
		expect(content.streamer?.usera).toHaveLength(1);
	});

	it('handles invalid existing file shape by rebuilding data', async () => {
		await writeFile(filePath, JSON.stringify({ bad: 'shape' }), 'utf-8');

		const count = await dataStore.storeImageData('Streamer', 'UserB', {
			image: 'https://example.com/b.png',
			analysis: 'analysis',
			prompt: 'prompt',
			date: '2026-02-07T00:00:00.000Z',
		});

		expect(count).toBe(1);
		const content = JSON.parse(await readFile(filePath, 'utf-8')) as Record<string, Record<string, unknown[]>>;
		expect(content.streamer?.userb).toHaveLength(1);
	});
});
