import { PathLike, promises as fs } from 'fs';

type BroadcasterBannedGiftersMap = Map<string, string[]>;

export class BannedGifterManager {
	private readonly broadcasterBannedGiftersMap: BroadcasterBannedGiftersMap = new Map();

	constructor(private readonly filePath: PathLike) {}

	async loadBannedGifters(): Promise<void> {
		try {
			const data = await fs.readFile(this.filePath, 'utf-8');
			const bannedGiftersData = JSON.parse(data) as Record<string, string[]>;
			this.broadcasterBannedGiftersMap.clear();
			for (const [broadcaster, bannedGifters] of Object.entries(bannedGiftersData)) {
				this.broadcasterBannedGiftersMap.set(
					broadcaster.toLowerCase(),
					bannedGifters.map((gifter) => gifter.toLowerCase()),
				);
			}
		} catch (error) {
			if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
				console.log(`Banned gifters file not found at ${this.filePath}, starting with empty list.`);
			} else {
				console.error(`Error reading banned gifters file at ${this.filePath}`, error);
			}
		}
	}

	async addBannedGifter(broadcaster: string, gifter: string): Promise<void> {
		const lowerBroadcaster = broadcaster.toLowerCase();
		const lowerGifter = gifter.toLowerCase();
		const bannedGifters: string[] = this.broadcasterBannedGiftersMap.get(lowerBroadcaster) || [];
		if (!bannedGifters.includes(lowerGifter)) {
			bannedGifters.push(lowerGifter);
			this.broadcasterBannedGiftersMap.set(lowerBroadcaster, bannedGifters);
			await this.saveBannedGifters();
		}
	}

	async removeBannedGifter(broadcaster: string, gifter: string): Promise<boolean> {
		const lowerBroadcaster = broadcaster.toLowerCase();
		const lowerGifter = gifter.toLowerCase();
		const bannedGifters: string[] = this.broadcasterBannedGiftersMap.get(lowerBroadcaster) || [];
		const index = bannedGifters.indexOf(lowerGifter);
		if (index > -1) {
			bannedGifters.splice(index, 1);
			this.broadcasterBannedGiftersMap.set(lowerBroadcaster, bannedGifters);
			await this.saveBannedGifters();
			return true;
		}
		return false;
	}

	async saveBannedGifters(): Promise<void> {
		try {
			const bannedGiftersData = Object.fromEntries(this.broadcasterBannedGiftersMap);
			await fs.writeFile(this.filePath, JSON.stringify(bannedGiftersData, null, 4), 'utf-8');
		} catch (error) {
			console.error(`Error saving banned gifters file at ${this.filePath}`, error);
		}
	}

	isGifterBanned(broadcaster: string, gifter: string): boolean {
		const bannedGifters = this.broadcasterBannedGiftersMap.get(broadcaster.toLowerCase()) || [];
		return bannedGifters.includes(gifter.toLowerCase());
	}

	getMap(): BroadcasterBannedGiftersMap {
		return new Map(this.broadcasterBannedGiftersMap);
	}
} 