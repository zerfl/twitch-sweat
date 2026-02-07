import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFile } from 'fs/promises';
import path from 'path';
import { ThemeManager } from '../../src/managers/ThemeManager';
import { cleanupTempDir, createTempDir } from '../helpers/tempDir';

describe('ThemeManager', () => {
	let manager: ThemeManager;
	let dirPath = '';

	beforeEach(async () => {
		dirPath = await createTempDir('theme-manager-');
		manager = new ThemeManager(path.join(dirPath, 'themes.json'));
		await manager.loadThemes();
	});

	afterEach(async () => {
		await cleanupTempDir(dirPath);
	});

	it('stores and loads broadcaster themes', async () => {
		await manager.setTheme('BroadCaster', 'winter mood');
		expect(manager.getBroadcasterTheme('broadcaster')).toBe('winter mood');

		const second = new ThemeManager(path.join(dirPath, 'themes.json'));
		await second.loadThemes();
		expect(second.getBroadcasterTheme('BROADCASTER')).toBe('winter mood');
	});

	it('removes a theme', async () => {
		await manager.setTheme('abc', 'hello');
		const wasRemoved = await manager.removeTheme('ABC');

		expect(wasRemoved).toBe(true);
		expect(manager.getBroadcasterTheme('abc')).toBeUndefined();
	});

	it('loads existing themes and reports missing deletions', async () => {
		await writeFile(path.join(dirPath, 'themes.json'), JSON.stringify({ streamerx: 'retro' }), 'utf-8');
		await manager.loadThemes();
		expect(manager.getBroadcasterTheme('StreamerX')).toBe('retro');
		expect(await manager.removeTheme('missing')).toBe(false);
	});
});
