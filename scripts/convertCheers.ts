import { promises as fs } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type OldCheerData = {
	broadcaster: string;
	users: {
		user: string;
		cheers: number;
	}[];
};

type NewCheerData = {
	[broadcaster: string]: {
		[user: string]: number;
	};
};

async function convertCheersFile() {
	const cheersFilePath = path.resolve(path.join(__dirname, '..', 'data', 'cheers.json'));
	const fileContent = JSON.parse(await fs.readFile(cheersFilePath, 'utf-8'));
	const oldData: OldCheerData[] = fileContent.cheers; // Adjusted this line
	const newData: NewCheerData = {};

	for (const { broadcaster, users } of oldData) {
		newData[broadcaster] = {};

		for (const { user, cheers } of users) {
			newData[broadcaster][user] = cheers;
		}
	}

	await fs.writeFile(cheersFilePath, JSON.stringify(newData, null, 4), 'utf-8');
}

convertCheersFile().catch(console.error);
