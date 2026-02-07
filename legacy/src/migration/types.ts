export interface LegacyImageRecord {
	image: string;
	analysis?: string | undefined;
	prompt?: string | undefined;
	revisedPrompt?: string | undefined;
	date: string;
}

export type LegacyImagesFile = Record<string, Record<string, LegacyImageRecord[]>>;
export type LegacyMeaningsFile = Record<string, string>;
export type LegacyThemesFile = Record<string, string>;
export type LegacyIgnoreFile = string[];
export type LegacyBannedGiftersFile = Record<string, string[]>;

export interface LegacyTokensFile {
	accessToken?: string | undefined;
	refreshToken?: string | undefined;
	scope?: string[] | undefined;
	expiresIn?: number | undefined;
	obtainmentTimestamp?: number | undefined;
}

export interface LegacyDataBundle {
	images: LegacyImagesFile;
	meanings: LegacyMeaningsFile;
	themes: LegacyThemesFile;
	ignore: LegacyIgnoreFile;
	bannedGifters: LegacyBannedGiftersFile;
	tokens: LegacyTokensFile;
}

export interface BroadcasterRow {
	name: string;
}

export interface UserRow {
	usernameCanonical: string;
	displayName: string;
}

export interface UserMeaningRow {
	usernameCanonical: string;
	meaning: string;
}

export interface BroadcasterThemeRow {
	broadcasterName: string;
	theme: string;
}

export interface IgnoredUserRow {
	usernameCanonical: string;
}

export interface BannedGifterRow {
	broadcasterName: string;
	usernameCanonical: string;
}

export interface ImageGenerationRow {
	broadcasterName: string;
	targetUsernameCanonical: string;
	imageUrl: string;
	analysisText: string | null;
	finalPrompt: string | null;
	createdAtIso: string;
}

export interface TwitchTokenRow {
	accessToken: string;
	refreshToken: string;
	scope: string[];
	expiresIn: number;
	obtainmentTimestamp: number;
}

export interface MigrationPayload {
	broadcasters: BroadcasterRow[];
	users: UserRow[];
	meanings: UserMeaningRow[];
	themes: BroadcasterThemeRow[];
	ignoredUsers: IgnoredUserRow[];
	bannedGifters: BannedGifterRow[];
	imageGenerations: ImageGenerationRow[];
	tokens: TwitchTokenRow | null;
}

export interface MigrationReport {
	counts: {
		broadcasters: number;
		users: number;
		meanings: number;
		themes: number;
		ignoredUsers: number;
		bannedGifters: number;
		imageGenerations: number;
		hasTokens: boolean;
	};
	warnings: string[];
}

export interface MigrationResult {
	payload: MigrationPayload;
	report: MigrationReport;
}
