import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

function collectTsFiles(dir: string): string[] {
	const entries = readdirSync(dir);
	const files: string[] = [];
	for (const entry of entries) {
		const fullPath = path.join(dir, entry);
		const stat = statSync(fullPath);
		if (stat.isDirectory()) {
			files.push(...collectTsFiles(fullPath));
			continue;
		}
		if (entry.endsWith('.ts')) {
			files.push(fullPath);
		}
	}
	return files;
}

describe('SRP boundary guards', () => {
	it('keeps adapters free of repository imports', () => {
		const root = new URL('../../src/adapters', import.meta.url);
		const files = collectTsFiles(root.pathname);
		for (const file of files) {
			const source = readFileSync(file, 'utf-8');
			expect(source).not.toMatch(/infrastructure\/repositories/);
		}
	});

	it('keeps use-cases free of transport/provider SDK imports', () => {
		const root = new URL('../../src/application/usecases', import.meta.url);
		const files = collectTsFiles(root.pathname);
		for (const file of files) {
			const source = readFileSync(file, 'utf-8');
			expect(source).not.toMatch(/@twurple\//);
			expect(source).not.toMatch(/discord\.js/);
			expect(source).not.toMatch(/from ['"]openai['"]/);
			expect(source).not.toMatch(/infrastructure\//);
		}
	});
});
