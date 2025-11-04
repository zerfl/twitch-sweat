/**
 * Unit tests for utility helper functions
 */

import { expect } from 'chai';
import { isAdminOrBroadcaster, truncate, exists, ensureFileExists } from '../../src/utils/helpers';
import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testDataDir = path.join(__dirname, '..', 'test-data');

describe('Utility Helpers', () => {
	before(async () => {
		// Create test data directory
		await fs.mkdir(testDataDir, { recursive: true });
	});

	after(async () => {
		// Clean up test data directory
		try {
			await fs.rm(testDataDir, { recursive: true, force: true });
		} catch (error) {
			// Ignore cleanup errors
		}
	});

	describe('isAdminOrBroadcaster()', () => {
		it('should return true when user is the broadcaster', () => {
			const admins = new Set(['admin1', 'admin2']);
			const result = isAdminOrBroadcaster('curvyspiderwife', 'curvyspiderwife', admins);
			expect(result).to.be.true;
		});

		it('should return true when user is in admins list', () => {
			const admins = new Set(['admin1', 'admin2']);
			const result = isAdminOrBroadcaster('admin1', 'curvyspiderwife', admins);
			expect(result).to.be.true;
		});

		it('should return false when user is neither broadcaster nor admin', () => {
			const admins = new Set(['admin1', 'admin2']);
			const result = isAdminOrBroadcaster('regularuser', 'curvyspiderwife', admins);
			expect(result).to.be.false;
		});

		it('should be case-insensitive', () => {
			const admins = new Set(['admin1']);
			const result = isAdminOrBroadcaster('ADMIN1', 'curvyspiderwife', admins);
			expect(result).to.be.true;
		});

		it('should handle empty admin list', () => {
			const admins = new Set<string>();
			const result = isAdminOrBroadcaster('regularuser', 'curvyspiderwife', admins);
			expect(result).to.be.false;
		});
	});

	describe('truncate()', () => {
		it('should not truncate strings shorter than limit', () => {
			const result = truncate('hello', 10);
			expect(result).to.equal('hello');
		});

		it('should truncate strings longer than limit', () => {
			const result = truncate('hello world this is a long string', 10);
			expect(result).to.equal('hello w...');
		});

		it('should handle exact length strings', () => {
			const result = truncate('exactly10!', 10);
			expect(result).to.equal('exactly10!');
		});

		it('should handle empty strings', () => {
			const result = truncate('', 10);
			expect(result).to.equal('');
		});

		it('should add ellipsis to truncated strings', () => {
			const result = truncate('12345678901234567890', 10);
			expect(result).to.have.length(10);
			expect(result).to.match(/\.\.\.$/);
		});
	});

	describe('exists()', () => {
		it('should return true for existing files', async () => {
			const testFile = path.join(testDataDir, 'existing-file.txt');
			await fs.writeFile(testFile, 'test content');

			const result = await exists(testFile);
			expect(result).to.be.true;
		});

		it('should return false for non-existing files', async () => {
			const testFile = path.join(testDataDir, 'non-existing-file.txt');
			const result = await exists(testFile);
			expect(result).to.be.false;
		});

		it('should return true for existing directories', async () => {
			const result = await exists(testDataDir);
			expect(result).to.be.true;
		});
	});

	describe('ensureFileExists()', () => {
		it('should create file if it does not exist', async () => {
			const testFile = path.join(testDataDir, 'new-file.txt');
			const defaultContent = 'default content';

			await ensureFileExists(testFile, defaultContent);

			const content = await fs.readFile(testFile, 'utf-8');
			expect(content).to.equal(defaultContent);
		});

		it('should not overwrite existing file', async () => {
			const testFile = path.join(testDataDir, 'existing-file-2.txt');
			const originalContent = 'original content';
			const defaultContent = 'default content';

			await fs.writeFile(testFile, originalContent);
			await ensureFileExists(testFile, defaultContent);

			const content = await fs.readFile(testFile, 'utf-8');
			expect(content).to.equal(originalContent);
		});

		it('should create file with empty content by default', async () => {
			const testFile = path.join(testDataDir, 'empty-file.txt');

			await ensureFileExists(testFile);

			const content = await fs.readFile(testFile, 'utf-8');
			expect(content).to.equal('');
		});
	});
});
