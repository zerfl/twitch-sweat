import { promises as fs } from 'fs';
import { z } from 'zod';
import type { IgnoreListRepository } from '../modules/storage/contracts';

const ignoreListSchema = z.array(z.string());

export class IgnoreListManager implements IgnoreListRepository {
	private ignoreList: Set<string>;
	private readonly filePath: string;

	constructor(filePath: string) {
		this.filePath = filePath;
		this.ignoreList = new Set();
	}

	public async loadIgnoreList(): Promise<void> {
		try {
			const data = await fs.readFile(this.filePath, 'utf-8');
			const parsed = ignoreListSchema.safeParse(JSON.parse(data) as unknown);
			this.ignoreList = new Set(parsed.success ? parsed.data : []);
		} catch (_error) {
			// create file if it doesn't exist
			await this.saveIgnoreList();
		}
	}

	public async saveIgnoreList(): Promise<void> {
		await fs.writeFile(this.filePath, JSON.stringify(Array.from(this.ignoreList), null, 4), 'utf-8');
	}

	public async addToIgnoreList(username: string): Promise<void> {
		this.ignoreList.add(username);
		await this.saveIgnoreList();
	}

	public async removeFromIgnoreList(username: string): Promise<void> {
		this.ignoreList.delete(username);
		await this.saveIgnoreList();
	}

	public isUserIgnored(username: string): boolean {
		return this.ignoreList.has(username);
	}
}
