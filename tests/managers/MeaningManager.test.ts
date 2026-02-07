import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFile } from 'fs/promises';
import path from 'path';
import { MeaningManager } from '../../src/managers/MeaningManager';
import { cleanupTempDir, createTempDir } from '../helpers/tempDir';

describe('MeaningManager', () => {
	let manager: MeaningManager;
	let dirPath = '';

	beforeEach(async () => {
		dirPath = await createTempDir('meaning-manager-');
		manager = new MeaningManager(path.join(dirPath, 'meanings.json'));
		await manager.loadMeanings();
	});

	afterEach(async () => {
		await cleanupTempDir(dirPath);
	});

	it('sets and gets meanings case-insensitively', async () => {
		await manager.setMeaning('MyUser', "mind's eye");
		expect(manager.getUserMeaning('myuser')).toBe("mind's eye");
	});

	it('returns original username when no meaning is set', () => {
		expect(manager.getUserMeaning('plainuser')).toBe('plainuser');
	});

	it('removes meanings', async () => {
		await manager.setMeaning('alpha', 'value');
		const removed = await manager.removeMeaning('ALPHA');
		expect(removed).toBe(true);
		expect(manager.getUserMeaning('alpha')).toBe('alpha');
	});

	it('loads existing meanings and returns false when deleting missing key', async () => {
		await writeFile(path.join(dirPath, 'meanings.json'), JSON.stringify({ beta: 'second' }), 'utf-8');
		await manager.loadMeanings();
		expect(manager.getUserMeaning('BETA')).toBe('second');
		expect(await manager.removeMeaning('gamma')).toBe(false);
	});
});
