import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ImageGeneration {
	image: string;
	revisedPrompt: string;
	date: string;
	style: string;
	theme?: string;
}

type UserGenerations = Record<string, ImageGeneration[]>;

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	const remainingMs = ms % 1000;
	return `${seconds}.${remainingMs.toString().padStart(3, '0')}s`;
}

function parseLine(line: string): { timestamp: string; id: string; username: string; action: string } | null {
	const match = line.match(/\[(.*?)\] \[(.*?)\] (.*?) (.*)/);
	if (!match) return null;

	const [_, timestamp, id, username, action] = match;
	return { timestamp, id, username, action };
}

function extractImageUrl(line: string): string | null {
	const match = line.match(/Image uploaded: (https:\/\/[^\s]+)/);
	return match ? match[1] : null;
}

function extractRevisedPrompt(line: string): string | null {
	const prefixIndex = line.indexOf('Revised prompt ');
	if (prefixIndex === -1) return null;

	return line.substring(prefixIndex + 'Revised prompt '.length).trim();
}

function extractStyle(line: string): string | null {
	const match = line.match(/Using template: (.*)/);
	return match ? match[1].trim() : null;
}

function extractTheme(line: string): string | null {
	let match = line.match(/Requesting structured output \(Theme: (.*?)\)/);
	if (match) {
		const theme = match[1].trim();

		return theme === 'None' ? '' : theme;
	}

	match = line.match(/Adding theme: (.*)/);
	if (match) {
		const theme = match[1].trim();

		return theme;
	}

	return null;
}

async function processLog() {
	console.log('Starting log processing...');
	const startTime = Date.now();

	console.log('Creating empty output file...');
	fs.writeFileSync(path.join(__dirname, '../data/logImages.json'), JSON.stringify({}, null, 2));
	console.log('Empty file created');

	console.log('Reading and processing log file backwards...');
	const processStartTime = Date.now();
	const logPath = path.join(__dirname, '../data/log.txt');

	const stats = fs.statSync(logPath);
	const fileSize = stats.size;
	console.log(`Log file size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

	let linesProcessed = 0;
	let validLines = 0;
	let imageUploadLines = 0;
	let revisedPromptLines = 0;
	let creatingImageLines = 0;
	let usingTemplateLines = 0;
	let themeLines = 0;
	let completeGenerations = 0;

	const userGenerations: UserGenerations = {};
	const pendingGenerations: Map<
		string,
		{
			username: string;
			imageUrl?: string;
			revisedPrompt?: string;
			style?: string;
			theme?: string;
		}
	> = new Map();

	const logContent = fs.readFileSync(logPath, 'utf-8');
	const logLines = logContent.split('\n').filter((line) => line.trim() !== '');
	console.log(`Found ${logLines.length} non-empty lines`);

	for (let i = logLines.length - 1; i >= 0; i--) {
		const line = logLines[i];
		linesProcessed++;

		if (linesProcessed % 10000 === 0) {
			const percent = ((linesProcessed / logLines.length) * 100).toFixed(1);
			console.log(`Processed ${linesProcessed}/${logLines.length} lines (${percent}%)`);
		}

		const parsed = parseLine(line);
		if (!parsed) continue;
		validLines++;

		const { timestamp, id, username, action } = parsed;

		if (action.includes('Image uploaded:')) {
			imageUploadLines++;
			const imageUrl = extractImageUrl(line);
			if (imageUrl) {
				pendingGenerations.set(id, {
					username,
					imageUrl,
				});
			}
		} else if (action.includes('Revised prompt')) {
			revisedPromptLines++;
			const revisedPrompt = extractRevisedPrompt(line);

			if (revisedPrompt && pendingGenerations.has(id)) {
				pendingGenerations.get(id)!.revisedPrompt = revisedPrompt;
			}
		} else if (action.includes('Creating image')) {
			creatingImageLines++;
			// if (pendingGenerations.has(id)) {
			//
			// }
		} else if (action.includes('Using template:')) {
			usingTemplateLines++;
			const style = extractStyle(line);

			if (style && pendingGenerations.has(id)) {
				pendingGenerations.get(id)!.style = style;
			}
		} else if (action.includes('Requesting structured output') || action.includes('Adding theme:')) {
			const theme = extractTheme(line);

			if (theme) {
				themeLines++;
				if (pendingGenerations.has(id)) {
					pendingGenerations.get(id)!.theme = theme;
				}
			}
		}

		if (pendingGenerations.has(id)) {
			const generation = pendingGenerations.get(id)!;

			if (generation.imageUrl && generation.revisedPrompt && generation.style) {
				if (!userGenerations[username]) {
					userGenerations[username] = [];
				}

				userGenerations[username].push({
					image: generation.imageUrl,
					revisedPrompt: generation.revisedPrompt,
					date: timestamp,
					style: generation.style,
					theme: generation.theme || '',
				});

				completeGenerations++;

				pendingGenerations.delete(id);
			}
		}
	}

	const processDuration = Date.now() - processStartTime;
	console.log(`Processing complete in ${formatDuration(processDuration)}`);
	console.log(`   - Valid log lines: ${validLines}`);
	console.log(`   - Image upload entries: ${imageUploadLines}`);
	console.log(`   - Revised prompt entries: ${revisedPromptLines}`);
	console.log(`   - Creating image entries: ${creatingImageLines}`);
	console.log(`   - Using template entries: ${usingTemplateLines}`);
	console.log(`   - Theme entries: ${themeLines}`);
	console.log(`   - Complete generations found: ${completeGenerations}`);
	console.log(`   - Unique users: ${Object.keys(userGenerations).length}`);

	console.log('Writing results to output file...');
	const writeStartTime = Date.now();
	fs.writeFileSync(path.join(__dirname, '../data/logImages.json'), JSON.stringify(userGenerations, null, 2));
	const writeDuration = Date.now() - writeStartTime;
	console.log(`Results saved to data/logImages.json in ${formatDuration(writeDuration)}`);

	const totalDuration = Date.now() - startTime;
	console.log(`\nLog processing complete in ${formatDuration(totalDuration)}`);
	console.log(`   Found ${completeGenerations} image generations for ${Object.keys(userGenerations).length} users`);
}

processLog();
