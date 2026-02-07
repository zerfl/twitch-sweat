import type { StoredImageRecord } from './types';

export interface ImageDataRepository {
	storeImageData(broadcaster: string, user: string, imageData: StoredImageRecord): Promise<number>;
}

export interface IgnoreListRepository {
	loadIgnoreList(): Promise<void>;
	saveIgnoreList(): Promise<void>;
	addToIgnoreList(username: string): Promise<void>;
	removeFromIgnoreList(username: string): Promise<void>;
	isUserIgnored(username: string): boolean;
}

export interface ThemeRepository {
	loadThemes(): Promise<void>;
	setTheme(broadcaster: string, theme: string): Promise<void>;
	removeTheme(broadcaster: string): Promise<boolean>;
	getBroadcasterTheme(broadcaster: string): string | undefined;
}

export interface MeaningRepository {
	loadMeanings(): Promise<void>;
	setMeaning(user: string, meaning: string): Promise<void>;
	removeMeaning(user: string): Promise<boolean>;
	getUserMeaning(user: string): string;
}

export interface BannedGifterRepository {
	loadBannedGifters(): Promise<void>;
	addBannedGifter(broadcaster: string, gifter: string): Promise<void>;
	removeBannedGifter(broadcaster: string, gifter: string): Promise<boolean>;
	isGifterBanned(broadcaster: string, gifter: string): boolean;
}
