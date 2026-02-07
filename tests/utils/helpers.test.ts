import { readFile } from 'fs/promises';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
	createSystemPrompt,
	ensureFileExists,
	exists,
	getAppRootDir,
	isAdminOrBroadcaster,
	retryAsyncOperation,
	truncate,
} from '../../src/utils/helpers';
import { cleanupTempDir, createTempDir } from '../helpers/tempDir';

describe('helpers', () => {
	it('checks broadcaster/admin permissions', () => {
		const admins = new Set(['mod1']);
		expect(isAdminOrBroadcaster('mod1', 'streamer', admins)).toBe(true);
		expect(isAdminOrBroadcaster('streamer', 'streamer', admins)).toBe(true);
		expect(isAdminOrBroadcaster('viewer', 'streamer', admins)).toBe(false);
	});

	it('truncates text with ellipsis', () => {
		expect(truncate('hello world', 8)).toBe('hello...');
		expect(truncate('short', 20)).toBe('short');
	});

	it('injects theme block into system prompt', () => {
		const prompt = createSystemPrompt('2026-02-07', 'winter', 'Today is __DATE__.\n__THEME_SECTION__');
		expect(prompt).toContain('Today is 2026-02-07.');
		expect(prompt).toContain('Theme Requirement: winter');
	});

	it('handles prompt creation without a theme section', () => {
		const prompt = createSystemPrompt('2026-02-07', undefined, 'Today is __DATE__.\n__THEME_SECTION__');
		expect(prompt).toContain('Today is 2026-02-07.');
		expect(prompt).not.toContain('Theme Requirement');
	});

	it('ensures files exist with default content', async () => {
		const dirPath = await createTempDir('helpers-');
		const filePath = path.join(dirPath, 'config.txt');

		await ensureFileExists(filePath, 'hello');
		expect(await exists(filePath)).toBe(true);
		expect(await readFile(filePath, 'utf-8')).toBe('hello');

		await ensureFileExists(filePath, 'changed');
		expect(await readFile(filePath, 'utf-8')).toBe('hello');

		await cleanupTempDir(dirPath);
	});

	it('resolves app root directory containing package.json', async () => {
		const root = await getAppRootDir();
		expect(await exists(path.join(root, 'package.json'))).toBe(true);
	});

	it('retries async operations until success', async () => {
		const operation = vi
			.fn<(target: string, attempt: number) => Promise<string>>()
			.mockRejectedValueOnce(new Error('fail once'))
			.mockResolvedValue('ok');

		const result = await retryAsyncOperation(operation, 2, 'target');
		expect(result).toBe('ok');
		expect(operation).toHaveBeenCalledTimes(2);
	});

	it('throws after retries are exhausted', async () => {
		const operation = vi.fn<(_attempt: number) => Promise<string>>().mockRejectedValue(new Error('always fails'));
		await expect(retryAsyncOperation(operation, 1)).rejects.toThrow('always fails');
		expect(operation).toHaveBeenCalledTimes(2);
	});
});
