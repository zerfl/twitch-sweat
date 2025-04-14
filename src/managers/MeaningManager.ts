import { PathLike, promises as fs } from 'fs';

type UserMeaningMap = Map<string, string>;

export class MeaningManager {
	private readonly userMeaningMap: UserMeaningMap = new Map();

	constructor(private readonly filePath: PathLike) {}

	async loadMeanings(): Promise<void> {
		try {
			const data = await fs.readFile(this.filePath, 'utf-8');
			const meanings = JSON.parse(data) as Record<string, string>;
			this.userMeaningMap.clear();
			Object.entries(meanings).forEach(([user, meaning]) => {
				this.userMeaningMap.set(user.toLowerCase(), meaning);
			});
		} catch (error) {
			if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
				console.log(`Meanings file not found at ${this.filePath}, starting with empty meanings.`);
			} else {
				console.error(`Error reading meanings file at ${this.filePath}`, error);
			}
		}
	}

	async setMeaning(user: string, meaning: string): Promise<void> {
		this.userMeaningMap.set(user.toLowerCase(), meaning);
		await this.saveMeanings();
	}

	async removeMeaning(user: string): Promise<boolean> {
		const deleted = this.userMeaningMap.delete(user.toLowerCase());
		if (deleted) {
			await this.saveMeanings();
		}
		return deleted;
	}

	async saveMeanings(): Promise<void> {
		try {
			const meanings = Object.fromEntries(this.userMeaningMap);
			await fs.writeFile(this.filePath, JSON.stringify(meanings, null, 4), 'utf-8');
		} catch (error) {
			console.error(`Error saving meanings file at ${this.filePath}`, error);
		}
	}

	getUserMeaning(user: string): string {
		return this.userMeaningMap.get(user.toLowerCase()) || user;
	}
} 