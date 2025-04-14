import * as path from 'path';
import { PathLike, promises as fs } from 'fs';
import { fileURLToPath } from 'url';

export const isAdminOrBroadcaster = (userName: string, broadcasterName: string, twitchAdmins: Set<string>): boolean => {
	const lowerUserName = userName.toLowerCase();
	const lowerBroadcasterName = broadcasterName.toLowerCase();
	const adminList = [...Array.from(twitchAdmins), lowerBroadcasterName];
	return adminList.includes(lowerUserName);
};

export async function ensureFileExists(filePath: string, defaultContent: string = ''): Promise<void> {
	try {
		await fs.access(filePath);
	} catch {
		await fs.writeFile(filePath, defaultContent, 'utf-8');
	}
}

export async function getAppRootDir(): Promise<string> {
	let tries = 0;
	let currentDir = path.dirname(fileURLToPath(import.meta.url));
	currentDir = path.join(currentDir, '..');
	let packageJsonPath = path.join(currentDir, 'package.json');
	let found = await exists(packageJsonPath);

	while (!found && tries < 10) {
		currentDir = path.join(currentDir, '..');
		packageJsonPath = path.join(currentDir, 'package.json');
		found = await exists(packageJsonPath);
		tries++;
	}

	if (!found) {
		throw new Error('package.json not found after 10 attempts');
	}

	return currentDir;
}

export async function exists(f: PathLike): Promise<boolean> {
	try {
		await fs.stat(f);
		return true;
	} catch {
		return false;
	}
}

export async function retryAsyncOperation<T, Args extends unknown[]>(
	asyncOperation: (...args: Args) => Promise<T>,
	maxRetries: number = 3,
	...args: Args
): Promise<T> {
	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await asyncOperation(...args);
		} catch (error) {
			if (error instanceof Error) {
				lastError = error;
			}
			if (attempt < maxRetries) {
				console.log(
					`[ERROR] Attempt ${attempt + 1} failed, retrying...: ${error instanceof Error ? error.message : error}`,
				);
			} else {
				console.log(
					`[ERROR] Attempt ${attempt + 1} failed, no more retries left: ${
						error instanceof Error ? error.message : error
					}`,
				);
			}
		}
	}

	if (lastError === null) {
		lastError = new Error('Retry operation failed without specific error.');
	}
	throw lastError;
}

export const truncate = (str: string, n: number): string => (str.length > n ? `${str.substring(0, n - 1)}...` : str); 