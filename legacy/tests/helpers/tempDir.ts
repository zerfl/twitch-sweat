import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

export async function createTempDir(prefix: string): Promise<string> {
	return mkdtemp(path.join(tmpdir(), prefix));
}

export async function cleanupTempDir(dirPath: string): Promise<void> {
	await rm(dirPath, { recursive: true, force: true });
}
