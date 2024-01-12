import { promises as fs } from 'fs';

export class IgnoreListManager {
	private ignoreList: Set<string>;
	private readonly filePath: string;

	constructor(filePath: string) {
		this.filePath = filePath;
		this.ignoreList = new Set();
	}

	public async loadIgnoreList(): Promise<void> {
		try {
			const data = await fs.readFile(this.filePath, 'utf-8');
			const ignoreList = JSON.parse(data) as string[];
			this.ignoreList = new Set(ignoreList);
		} catch (error) {
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
