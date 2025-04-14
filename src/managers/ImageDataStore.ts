import { PathLike, promises as fs } from 'fs';

// TODO: These types should ideally be moved to a central types file later
type SingleImage = {
	image: string;
	analysis: string;
	revisedPrompt: string;
	date: string;
};

type BroadcasterImages = {
	[broadcaster: string]: {
		[user: string]: SingleImage[];
	};
};

export class ImageDataStore {
	constructor(private readonly filePath: PathLike) {}

	// TODO: This is seriously inefficient, we need to store the data in a database ASAP
	async storeImageData(broadcaster: string, user: string, imageData: SingleImage): Promise<number> {
		let broadcasterImageData: BroadcasterImages = {};
		const lowerBroadcaster = broadcaster.toLowerCase();
		const lowerUser = user.toLowerCase();

		try {
			const fileContent = await fs.readFile(this.filePath, 'utf-8');
			broadcasterImageData = JSON.parse(fileContent);
		} catch (error) {
			if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
				console.log(`Images file not found at ${this.filePath}, starting with empty data.`);
			} else {
				console.error(`Error reading image file at ${this.filePath}`, error);
			}
		}

		const broadcasterMap = broadcasterImageData[lowerBroadcaster] || {};
		const userImages = broadcasterMap[lowerUser] || [];
		userImages.push(imageData);

		broadcasterMap[lowerUser] = userImages;
		broadcasterImageData[lowerBroadcaster] = broadcasterMap;

		try {
			await fs.writeFile(this.filePath, JSON.stringify(broadcasterImageData, null, 4), 'utf-8');
		} catch (error) {
			console.error(`Error saving image data file at ${this.filePath}`, error);
		}

		let totalImages = 0;
		const currentBroadcasterData = broadcasterImageData[lowerBroadcaster];
		if (currentBroadcasterData) {
			for (const userData of Object.values(currentBroadcasterData)) {
				totalImages += userData.length;
			}
		}

		return totalImages;
	}

	// Optional: Add a method to load data if needed elsewhere
	// async loadImageData(): Promise<BroadcasterImages> { ... }
} 