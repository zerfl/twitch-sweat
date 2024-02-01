import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

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

async function convertImagesFile() {
	const imagesFilePath = path.resolve(path.join(__dirname, '..', 'data', 'images.json'));
	const oldData: BroadcasterImagesOld = JSON.parse(await fs.readFile(imagesFilePath, 'utf-8'));
	const newData: BroadcasterImagesNew = {};

	for (const broadcaster in oldData) {
		newData[broadcaster] = {};

		for (const image of oldData[broadcaster]) {
			if (!newData[broadcaster][image.user]) {
				newData[broadcaster][image.user] = [];
			}

			newData[broadcaster][image.user].push({
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
