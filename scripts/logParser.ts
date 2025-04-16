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
	theme: string;
}

type UserGenerations = Record<string, ImageGeneration[]>;

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.floor(ms / 1000);
	const remainingMs = ms % 1000;
	return `${seconds}.${remainingMs.toString().padStart(3, '0')}s`;
}

function parseLineWithId(line: string): { timestamp: string; id: string; username: string; action: string } | null {
	const match = line.match(/\[(.*?)\] \[(.*?)\] (.*?) (.*)/);
	if (!match) return null;

	const [_, timestamp, id, username, action] = match;
	return { timestamp, id, username, action };
}

function parseLineWithoutId(line: string): { timestamp: string; username: string; action: string } | null {
	const match = line.match(/\[(.*?)\] (.*?) (.*)/);
	if (!match) return null;

	const [_, timestamp, username, action] = match;
	return { timestamp, username, action };
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

function isLegacyDateFormat(timestamp: string): boolean {
	const idStartDate = new Date('2024-04-25T22:42:07.453Z');
	const lineDate = new Date(timestamp);
	return lineDate < idStartDate;
}

async function processLog(logFilePath: string, outputFilePath: string) {
	console.log('Starting log processing...');
	console.log(`Input log file: ${logFilePath}`);
	console.log(`Output file: ${outputFilePath}`);
	const startTime = Date.now();

	console.log('Creating empty output file...');
	fs.writeFileSync(outputFilePath, JSON.stringify({}, null, 2));
	console.log('Empty file created');

	console.log('Reading and processing log file backwards...');
	const processStartTime = Date.now();

	const stats = fs.statSync(logFilePath);
	const fileSize = stats.size;
	console.log(`Log file size: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

	let linesProcessed = 0;
	let validLines = 0;
	let imageUploadLines = 0;
	let revisedPromptLines = 0;
	let creatingImageLines = 0;
	let analysingTextLines = 0;
	let usingTemplateLines = 0;
	let themeLines = 0;
	let completeGenerationsWithId = 0;
	let completeGenerationsWithoutId = 0;

	const userGenerations: UserGenerations = {};

	const pendingGenerationsWithId: Map<
		string,
		{
			username: string;
			imageUrl?: string;
			revisedPrompt?: string;
			style?: string;
			theme?: string;
			timestamp: string;
		}
	> = new Map();

	const pendingGenerationsWithoutId: Map<
		string,
		{
			imageUrl?: string;
			revisedPrompt?: string;
			style?: string;
			theme?: string;
			timestamp: string;
			lastUpdated: Date;
		}
	> = new Map();

	const logContent = fs.readFileSync(logFilePath, 'utf-8');
	const logLines = logContent.split('\n').filter((line) => line.trim() !== '');
	console.log(`Found ${logLines.length} non-empty lines`);

	const TIME_WINDOW_MS = 60 * 1000;

	for (let i = logLines.length - 1; i >= 0; i--) {
		const line = logLines[i];
		linesProcessed++;

		if (linesProcessed % 10000 === 0) {
			const percent = ((linesProcessed / logLines.length) * 100).toFixed(1);
			console.log(`Processed ${linesProcessed}/${logLines.length} lines (${percent}%)`);
		}

		const parsedWithId = parseLineWithId(line);

		if (parsedWithId) {
			validLines++;
			const { timestamp, id, username, action } = parsedWithId;

			if (action.includes('Image uploaded:')) {
				imageUploadLines++;
				const imageUrl = extractImageUrl(line);
				if (imageUrl) {
					pendingGenerationsWithId.set(id, {
						username,
						imageUrl,
						timestamp,
					});
				}
			} else if (action.includes('Revised prompt')) {
				revisedPromptLines++;
				const revisedPrompt = extractRevisedPrompt(line);

				if (revisedPrompt && pendingGenerationsWithId.has(id)) {
					pendingGenerationsWithId.get(id)!.revisedPrompt = revisedPrompt;
				}
			} else if (action.includes('Creating image')) {
				creatingImageLines++;
			} else if (action.includes('Using template:')) {
				usingTemplateLines++;
				const style = extractStyle(line);

				if (style && pendingGenerationsWithId.has(id)) {
					pendingGenerationsWithId.get(id)!.style = style;
				}
			} else if (action.includes('Requesting structured output') || action.includes('Adding theme:')) {
				const theme = extractTheme(line);

				if (theme !== null) {
					themeLines++;
					if (pendingGenerationsWithId.has(id)) {
						pendingGenerationsWithId.get(id)!.theme = theme;
					}
				}
			}

			if (pendingGenerationsWithId.has(id)) {
				const generation = pendingGenerationsWithId.get(id)!;

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

					completeGenerationsWithId++;
					pendingGenerationsWithId.delete(id);
				}
			}
		} else {
			const parsedWithoutId = parseLineWithoutId(line);

			if (parsedWithoutId) {
				validLines++;
				const { timestamp, username, action } = parsedWithoutId;
				const lineDate = new Date(timestamp);

				if (isLegacyDateFormat(timestamp)) {
					if (action.includes('Image uploaded:')) {
						imageUploadLines++;
						const imageUrl = extractImageUrl(line);
						if (imageUrl) {
							pendingGenerationsWithoutId.set(username, {
								imageUrl,
								timestamp,
								lastUpdated: lineDate,
							});
						}
					} else if (action.includes('Revised prompt')) {
						revisedPromptLines++;
						const revisedPrompt = extractRevisedPrompt(line);

						if (revisedPrompt && pendingGenerationsWithoutId.has(username)) {
							const pending = pendingGenerationsWithoutId.get(username)!;

							if (lineDate.getTime() - pending.lastUpdated.getTime() < TIME_WINDOW_MS) {
								pending.revisedPrompt = revisedPrompt;
								pending.lastUpdated = lineDate;
							}
						}
					} else if (action.includes('Analysing text:')) {
						analysingTextLines++;
					} else if (action.includes('Using template:')) {
						usingTemplateLines++;
						const style = extractStyle(line);

						if (style && pendingGenerationsWithoutId.has(username)) {
							const pending = pendingGenerationsWithoutId.get(username)!;

							if (lineDate.getTime() - pending.lastUpdated.getTime() < TIME_WINDOW_MS) {
								pending.style = style;
								pending.lastUpdated = lineDate;
							}
						}
					} else if (action.includes('Requesting structured output') || action.includes('Adding theme:')) {
						const theme = extractTheme(line);

						if (theme !== null) {
							themeLines++;
							if (pendingGenerationsWithoutId.has(username)) {
								const pending = pendingGenerationsWithoutId.get(username)!;

								if (lineDate.getTime() - pending.lastUpdated.getTime() < TIME_WINDOW_MS) {
									pending.theme = theme;
									pending.lastUpdated = lineDate;
								}
							}
						}
					}

					// For old format, we only require imageUrl and revisedPrompt
					if (pendingGenerationsWithoutId.has(username)) {
						const generation = pendingGenerationsWithoutId.get(username)!;

						if (generation.imageUrl && generation.revisedPrompt) {
							if (!userGenerations[username]) {
								userGenerations[username] = [];
							}

							userGenerations[username].push({
								image: generation.imageUrl,
								revisedPrompt: generation.revisedPrompt,
								date: timestamp,
								style: generation.style || '',
								theme: generation.theme || '',
							});

							completeGenerationsWithoutId++;
							pendingGenerationsWithoutId.delete(username);
						}
					}
				}
			}
		}
	}

	for (const [username, generation] of pendingGenerationsWithoutId.entries()) {
		if (generation.imageUrl && generation.revisedPrompt) {
			if (!userGenerations[username]) {
				userGenerations[username] = [];
			}

			userGenerations[username].push({
				image: generation.imageUrl,
				revisedPrompt: generation.revisedPrompt,
				date: generation.timestamp,
				style: generation.style || '',
				theme: generation.theme || '',
			});

			completeGenerationsWithoutId++;
		}
	}

	const processDuration = Date.now() - processStartTime;
	console.log(`Processing complete in ${formatDuration(processDuration)}`);
	console.log(`   - Valid log lines: ${validLines}`);
	console.log(`   - Image upload entries: ${imageUploadLines}`);
	console.log(`   - Revised prompt entries: ${revisedPromptLines}`);
	console.log(`   - Creating image entries: ${creatingImageLines}`);
	console.log(`   - Analysing text entries: ${analysingTextLines}`);
	console.log(`   - Using template entries: ${usingTemplateLines}`);
	console.log(`   - Theme entries: ${themeLines}`);
	console.log(`   - Complete generations with ID: ${completeGenerationsWithId}`);
	console.log(`   - Complete generations without ID: ${completeGenerationsWithoutId}`);
	console.log(`   - Total complete generations: ${completeGenerationsWithId + completeGenerationsWithoutId}`);
	console.log(`   - Unique users: ${Object.keys(userGenerations).length}`);

	console.log('Writing results to output file...');
	const writeStartTime = Date.now();
	fs.writeFileSync(outputFilePath, JSON.stringify(userGenerations, null, 2));
	const writeDuration = Date.now() - writeStartTime;
	console.log(`Results saved to ${outputFilePath} in ${formatDuration(writeDuration)}`);

	const totalDuration = Date.now() - startTime;
	console.log(`\nLog processing complete in ${formatDuration(totalDuration)}`);
	console.log(
		`   Found ${completeGenerationsWithId + completeGenerationsWithoutId} image generations for ${Object.keys(userGenerations).length} users`,
	);
}

const args = process.argv.slice(2);
const logFilePath = args[0] || path.join(__dirname, '../data/log.txt');

const logFileDir = path.dirname(logFilePath);
const logFileName = path.basename(logFilePath, path.extname(logFilePath));
const outputFilePath = path.join(logFileDir, `${logFileName}Images.json`);

processLog(logFilePath, outputFilePath);
