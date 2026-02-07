import { z } from 'zod';
import {
	type LegacyBannedGiftersFile,
	type LegacyDataBundle,
	type LegacyIgnoreFile,
	type LegacyImagesFile,
	type LegacyMeaningsFile,
	type LegacyThemesFile,
	type LegacyTokensFile,
	type MigrationResult,
	type TwitchTokenRow,
	type UserRow,
} from './types';

const imageRecordSchema = z.object({
	image: z.string().url(),
	analysis: z.string().optional(),
	prompt: z.string().optional(),
	revisedPrompt: z.string().optional(),
	date: z.string(),
});

const imagesFileSchema = z.record(z.string(), z.record(z.string(), z.array(imageRecordSchema)));
const meaningsFileSchema = z.record(z.string(), z.string());
const themesFileSchema = z.record(z.string(), z.string());
const ignoreFileSchema = z.array(z.string());
const bannedGiftersFileSchema = z.record(z.string(), z.array(z.string()));
const tokensFileSchema = z.object({
	accessToken: z.string().optional(),
	refreshToken: z.string().optional(),
	scope: z.array(z.string()).optional(),
	expiresIn: z.number().int().optional(),
	obtainmentTimestamp: z.number().int().optional(),
});

export function parseLegacyImagesFile(input: unknown): LegacyImagesFile {
	return imagesFileSchema.parse(input);
}

export function parseLegacyMeaningsFile(input: unknown): LegacyMeaningsFile {
	return meaningsFileSchema.parse(input);
}

export function parseLegacyThemesFile(input: unknown): LegacyThemesFile {
	return themesFileSchema.parse(input);
}

export function parseLegacyIgnoreFile(input: unknown): LegacyIgnoreFile {
	return ignoreFileSchema.parse(input);
}

export function parseLegacyBannedGiftersFile(input: unknown): LegacyBannedGiftersFile {
	return bannedGiftersFileSchema.parse(input);
}

export function parseLegacyTokensFile(input: unknown): LegacyTokensFile {
	return tokensFileSchema.parse(input);
}

function normalize(value: string): string {
	return value.trim().toLowerCase();
}

function ensureUser(userMap: Map<string, UserRow>, username: string): void {
	const canonical = normalize(username);
	if (!canonical) {
		return;
	}
	if (!userMap.has(canonical)) {
		userMap.set(canonical, {
			usernameCanonical: canonical,
			displayName: username,
		});
	}
}

function parseDate(value: string): string | null {
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return null;
	}
	return parsed.toISOString();
}

export function buildMigrationResult(data: LegacyDataBundle): MigrationResult {
	const broadcasterSet = new Set<string>();
	const userMap = new Map<string, UserRow>();
	const warnings: string[] = [];
	const imageGenerations: MigrationResult['payload']['imageGenerations'] = [];

	for (const [broadcaster, users] of Object.entries(data.images)) {
		const broadcasterName = normalize(broadcaster);
		if (!broadcasterName) {
			warnings.push('Skipped image records for empty broadcaster name.');
			continue;
		}

		broadcasterSet.add(broadcasterName);

		for (const [username, records] of Object.entries(users)) {
			const canonical = normalize(username);
			if (!canonical) {
				warnings.push(`Skipped image records for empty username in broadcaster ${broadcasterName}.`);
				continue;
			}
			ensureUser(userMap, username);

			for (const record of records) {
				const createdAtIso = parseDate(record.date);
				if (!createdAtIso) {
					warnings.push(`Skipped image for ${canonical}: invalid date '${record.date}'.`);
					continue;
				}

				if (record.analysis?.includes('[object Object]')) {
					warnings.push(`Analysis for ${canonical} appears to be legacy object-string content.`);
				}

				imageGenerations.push({
					broadcasterName,
					targetUsernameCanonical: canonical,
					imageUrl: record.image,
					analysisText: record.analysis ?? null,
					finalPrompt: record.prompt ?? record.revisedPrompt ?? null,
					createdAtIso,
				});
			}
		}
	}

	const meanings: MigrationResult['payload']['meanings'] = [];
	for (const [username, meaning] of Object.entries(data.meanings)) {
		const canonical = normalize(username);
		if (!canonical) {
			warnings.push('Skipped meaning row for empty username.');
			continue;
		}
		ensureUser(userMap, username);
		meanings.push({ usernameCanonical: canonical, meaning });
	}

	const themes: MigrationResult['payload']['themes'] = [];
	for (const [broadcaster, theme] of Object.entries(data.themes)) {
		const broadcasterName = normalize(broadcaster);
		if (!broadcasterName) {
			warnings.push('Skipped theme row for empty broadcaster name.');
			continue;
		}
		broadcasterSet.add(broadcasterName);
		themes.push({ broadcasterName, theme });
	}

	const ignoredUsers: MigrationResult['payload']['ignoredUsers'] = [];
	for (const username of data.ignore) {
		const canonical = normalize(username);
		if (!canonical) {
			continue;
		}
		ensureUser(userMap, username);
		ignoredUsers.push({ usernameCanonical: canonical });
	}

	const bannedGifters: MigrationResult['payload']['bannedGifters'] = [];
	for (const [broadcaster, gifters] of Object.entries(data.bannedGifters)) {
		const broadcasterName = normalize(broadcaster);
		if (!broadcasterName) {
			warnings.push('Skipped banned-gifter row for empty broadcaster name.');
			continue;
		}
		broadcasterSet.add(broadcasterName);
		for (const gifter of gifters) {
			const canonical = normalize(gifter);
			if (!canonical) {
				continue;
			}
			ensureUser(userMap, gifter);
			bannedGifters.push({ broadcasterName, usernameCanonical: canonical });
		}
	}

	const hasTokenFields =
		typeof data.tokens.accessToken === 'string' &&
		typeof data.tokens.refreshToken === 'string' &&
		Array.isArray(data.tokens.scope) &&
		typeof data.tokens.expiresIn === 'number' &&
		typeof data.tokens.obtainmentTimestamp === 'number';

	if (!hasTokenFields) {
		warnings.push('Token file is incomplete; no token payload will be emitted.');
	}

	let tokens: TwitchTokenRow | null = null;
	if (hasTokenFields) {
		tokens = {
			accessToken: data.tokens.accessToken!,
			refreshToken: data.tokens.refreshToken!,
			scope: data.tokens.scope!,
			expiresIn: data.tokens.expiresIn!,
			obtainmentTimestamp: data.tokens.obtainmentTimestamp!,
		};
	}

	const payload: MigrationResult['payload'] = {
		broadcasters: Array.from(broadcasterSet).map((name) => ({ name })),
		users: Array.from(userMap.values()),
		meanings,
		themes,
		ignoredUsers,
		bannedGifters,
		imageGenerations,
		tokens,
	};

	return {
		payload,
		report: {
			counts: {
				broadcasters: payload.broadcasters.length,
				users: payload.users.length,
				meanings: payload.meanings.length,
				themes: payload.themes.length,
				ignoredUsers: payload.ignoredUsers.length,
				bannedGifters: payload.bannedGifters.length,
				imageGenerations: payload.imageGenerations.length,
				hasTokens: payload.tokens !== null,
			},
			warnings,
		},
	};
}
