import { PathLike, promises as fs } from 'fs';

type BroadcasterThemeMap = Map<string, string>;

export class ThemeManager {
	private readonly broadcasterThemeMap: BroadcasterThemeMap = new Map();

	constructor(private readonly filePath: PathLike) {}

	async loadThemes(): Promise<void> {
		try {
			const data = await fs.readFile(this.filePath, 'utf-8');
			const themes = JSON.parse(data) as Record<string, string>;
			this.broadcasterThemeMap.clear();
			Object.entries(themes).forEach(([broadcaster, theme]) => {
				this.broadcasterThemeMap.set(broadcaster.toLowerCase(), theme);
			});
		} catch (error) {
			if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
				console.log(`Theme file not found at ${this.filePath}, starting with empty themes.`);
			} else {
				console.error(`Error reading themes file at ${this.filePath}`, error);
			}
		}
	}

	async setTheme(broadcaster: string, theme: string): Promise<void> {
		this.broadcasterThemeMap.set(broadcaster.toLowerCase(), theme);
		await this.saveThemes();
	}

	async removeTheme(broadcaster: string): Promise<boolean> {
		const deleted = this.broadcasterThemeMap.delete(broadcaster.toLowerCase());
		if (deleted) {
			await this.saveThemes();
		}
		return deleted;
	}

	async saveThemes(): Promise<void> {
		try {
			const themes = Object.fromEntries(this.broadcasterThemeMap);
			await fs.writeFile(this.filePath, JSON.stringify(themes, null, 4), 'utf-8');
		} catch (error) {
			console.error(`Error saving themes file at ${this.filePath}`, error);
		}
	}

	getBroadcasterTheme(broadcaster: string): string {
		return this.broadcasterThemeMap.get(broadcaster.toLowerCase()) || '';
	}
} 