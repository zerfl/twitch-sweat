import { PathLike, promises as fs } from 'fs';
import { z } from 'zod';
import type { ImageDataRepository } from '../modules/storage/contracts';
import type { BroadcasterImages, StoredImageRecord } from '../modules/storage/types';

const singleImageSchema = z.object({
	image: z.string(),
	analysis: z.string(),
	prompt: z.string(),
	date: z.string(),
});

const broadcasterImagesSchema = z.record(z.string(), z.record(z.string(), z.array(singleImageSchema)));

export class ImageDataStore implements ImageDataRepository {
	constructor(private readonly filePath: PathLike) {}

	// TODO: This is seriously inefficient, we need to store the data in a database ASAP
	async storeImageData(broadcaster: string, user: string, imageData: StoredImageRecord): Promise<number> {
		let broadcasterImageData: BroadcasterImages = {};
		const lowerBroadcaster = broadcaster.toLowerCase();
		const lowerUser = user.toLowerCase();

		try {
			const fileContent = await fs.readFile(this.filePath, 'utf-8');
			const parsed = broadcasterImagesSchema.safeParse(JSON.parse(fileContent) as unknown);
			if (parsed.success) {
				broadcasterImageData = parsed.data;
			} else {
				console.error(`Images file had an invalid shape at ${String(this.filePath)}, starting with empty data.`);
			}
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
}
