import { beforeEach, describe, expect, it } from 'vitest';
import { writeFile } from 'fs/promises';
import path from 'path';
import { IgnoreListManager } from '../../src/managers/IgnoreListManager';
import { cleanupTempDir, createTempDir } from '../helpers/tempDir';

describe('IgnoreListManager', () => {
	let ignoreListManager: IgnoreListManager;
	let dirPath = '';

	beforeEach(async () => {
		dirPath = await createTempDir('ignore-list-');
		ignoreListManager = new IgnoreListManager(path.join(dirPath, 'ignore.json'));
		await ignoreListManager.loadIgnoreList();
	});

	it('adds user to ignore list', async () => {
		const username = 'user1';
		await ignoreListManager.addToIgnoreList(username);
		expect(ignoreListManager.isUserIgnored(username)).toBe(true);
		await cleanupTempDir(dirPath);
	});

	it('removes user from ignore list', async () => {
		const username = 'user1';
		await ignoreListManager.addToIgnoreList(username);
		await ignoreListManager.removeFromIgnoreList(username);
		expect(ignoreListManager.isUserIgnored(username)).toBe(false);
		await cleanupTempDir(dirPath);
	});

	it('falls back to an empty list when existing file content is invalid', async () => {
		await writeFile(path.join(dirPath, 'ignore.json'), JSON.stringify({ invalid: true }), 'utf-8');
		await ignoreListManager.loadIgnoreList();
		expect(ignoreListManager.isUserIgnored('invalid')).toBe(false);
		await cleanupTempDir(dirPath);
	});
});
