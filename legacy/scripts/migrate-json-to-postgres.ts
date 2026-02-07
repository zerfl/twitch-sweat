import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import {
	buildMigrationResult,
	parseLegacyBannedGiftersFile,
	parseLegacyIgnoreFile,
	parseLegacyImagesFile,
	parseLegacyMeaningsFile,
	parseLegacyThemesFile,
	parseLegacyTokensFile,
} from '../src/migration/jsonToPostgres';

interface CliArgs {
	inputDir: string;
	outputFile: string;
}

function parseArgs(argv: string[]): CliArgs {
	const args = new Map<string, string>();
	for (let i = 0; i < argv.length; i += 2) {
		const key = argv[i];
		const value = argv[i + 1];
		if (key && value) {
			args.set(key, value);
		}
	}

	return {
		inputDir: args.get('--input-dir') ?? 'data',
		outputFile: args.get('--output-file') ?? 'artifacts/migration-report.json',
	};
}

async function readJsonFile(filePath: string): Promise<unknown> {
	const content = await readFile(filePath, 'utf-8');
	return JSON.parse(content) as unknown;
}

async function main(): Promise<void> {
	const { inputDir, outputFile } = parseArgs(process.argv.slice(2));
	const data = {
		images: parseLegacyImagesFile(await readJsonFile(path.join(inputDir, 'images.json'))),
		meanings: parseLegacyMeaningsFile(await readJsonFile(path.join(inputDir, 'meanings.json'))),
		themes: parseLegacyThemesFile(await readJsonFile(path.join(inputDir, 'themes.json'))),
		ignore: parseLegacyIgnoreFile(await readJsonFile(path.join(inputDir, 'ignore.json'))),
		bannedGifters: parseLegacyBannedGiftersFile(await readJsonFile(path.join(inputDir, 'bannedGifters.json'))),
		tokens: parseLegacyTokensFile(await readJsonFile(path.join(inputDir, 'tokens.json'))),
	};

	const result = buildMigrationResult(data);
	await mkdir(path.dirname(outputFile), { recursive: true });
	await writeFile(outputFile, JSON.stringify(result, null, 2), 'utf-8');
	console.log(`Migration report written to ${outputFile}`);
	console.log(`Rows: ${JSON.stringify(result.report.counts)}`);
	console.log(`Warnings: ${result.report.warnings.length}`);
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Migration failed: ${message}`);
	process.exitCode = 1;
});
