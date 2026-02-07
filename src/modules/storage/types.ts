export interface StoredImageRecord {
	image: string;
	analysis: string;
	prompt: string;
	date: string;
}

export type BroadcasterImages = Record<string, Record<string, StoredImageRecord[]>>;

export interface BroadcasterTheme {
	broadcaster: string;
	theme: string;
}

export interface UserMeaning {
	user: string;
	meaning: string;
}

export interface BannedGifter {
	broadcaster: string;
	gifter: string;
}
