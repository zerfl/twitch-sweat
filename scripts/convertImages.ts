import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { z } from 'zod';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type OldImageData = {
	user: string;
	image: string;
	date: string;
};

type NewImageData = {
	image: string;
	analysis: string;
	revisedPrompt: string;
	date: string;
};

type BroadcasterImagesOld = {
	[key: string]: OldImageData[];
};

type BroadcasterImagesNew = {
	[key: string]: { [key: string]: NewImageData[] };
};

const oldImageDataSchema = z.object({
	user: z.string(),
	image: z.string(),
	date: z.string(),
});

const broadcasterImagesOldSchema = z.record(z.string(), z.array(oldImageDataSchema));

async function convertImagesFile() {
	const imagesFilePath = path.resolve(path.join(__dirname, '..', 'data', 'images.json'));
	const parsed = broadcasterImagesOldSchema.parse(JSON.parse(await fs.readFile(imagesFilePath, 'utf-8')) as unknown);
	const oldData: BroadcasterImagesOld = parsed;
	const newData: BroadcasterImagesNew = {};

	for (const [broadcaster, images] of Object.entries(oldData)) {
		newData[broadcaster] = {};
		const broadcasterImages = newData[broadcaster];
		if (!broadcasterImages) {
			continue;
		}

		for (const image of images) {
			if (!broadcasterImages[image.user]) {
				broadcasterImages[image.user] = [];
			}

			const userImages = broadcasterImages[image.user];
			if (!userImages) {
				continue;
			}

			userImages.push({
				image: image.image,
				date: image.date,
				analysis: '',
				revisedPrompt: '',
			});
		}
	}

	await fs.writeFile(imagesFilePath, JSON.stringify(newData, null, 4), 'utf-8');
}

convertImagesFile().catch(console.error);
