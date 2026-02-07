import { and, eq } from 'drizzle-orm';
import type { DbClient } from '../db/client';
import {
	bannedGiftersTable,
	broadcasterThemesTable,
	ignoreUsersTable,
	userMeaningsTable,
} from '../db/schema';

function normalize(value: string): string {
	return value.trim().toLowerCase();
}

export class PreferenceRepository {
	constructor(
		private readonly db: DbClient,
		private readonly broadcasterName: string,
	) {}

	private broadcaster(): string {
		return normalize(this.broadcasterName);
	}

	async isUserIgnored(userName: string): Promise<boolean> {
		const normalized = normalize(userName);
		const rows = await this.db
			.select({ id: ignoreUsersTable.id })
			.from(ignoreUsersTable)
			.where(eq(ignoreUsersTable.usernameCanonical, normalized))
			.limit(1);
		return rows.length > 0;
	}

	async addIgnoredUser(userName: string): Promise<void> {
		const normalized = normalize(userName);
		await this.db
			.insert(ignoreUsersTable)
			.values({ usernameCanonical: normalized })
			.onConflictDoNothing({ target: ignoreUsersTable.usernameCanonical });
	}

	async removeIgnoredUser(userName: string): Promise<void> {
		const normalized = normalize(userName);
		await this.db.delete(ignoreUsersTable).where(eq(ignoreUsersTable.usernameCanonical, normalized));
	}

	async setTheme(theme: string): Promise<void> {
		const broadcaster = this.broadcaster();
		await this.db
			.insert(broadcasterThemesTable)
			.values({ broadcasterName: broadcaster, theme })
			.onConflictDoUpdate({
				target: broadcasterThemesTable.broadcasterName,
				set: { theme, updatedAt: new Date() },
			});
	}

	async removeTheme(): Promise<boolean> {
		const broadcaster = this.broadcaster();
		const result = await this.db
			.delete(broadcasterThemesTable)
			.where(eq(broadcasterThemesTable.broadcasterName, broadcaster))
			.returning({ id: broadcasterThemesTable.id });
		return result.length > 0;
	}

	async getTheme(): Promise<string | undefined> {
		const broadcaster = this.broadcaster();
		const rows = await this.db
			.select({ theme: broadcasterThemesTable.theme })
			.from(broadcasterThemesTable)
			.where(eq(broadcasterThemesTable.broadcasterName, broadcaster))
			.limit(1);
		return rows[0]?.theme;
	}

	async setMeaning(userName: string, meaning: string): Promise<void> {
		const normalized = normalize(userName);
		await this.db
			.insert(userMeaningsTable)
			.values({ usernameCanonical: normalized, meaning })
			.onConflictDoUpdate({
				target: userMeaningsTable.usernameCanonical,
				set: { meaning, updatedAt: new Date() },
			});
	}

	async removeMeaning(userName: string): Promise<boolean> {
		const normalized = normalize(userName);
		const deleted = await this.db
			.delete(userMeaningsTable)
			.where(eq(userMeaningsTable.usernameCanonical, normalized))
			.returning({ id: userMeaningsTable.id });
		return deleted.length > 0;
	}

	async getMeaning(userName: string): Promise<string> {
		const normalized = normalize(userName);
		const rows = await this.db
			.select({ meaning: userMeaningsTable.meaning })
			.from(userMeaningsTable)
			.where(eq(userMeaningsTable.usernameCanonical, normalized))
			.limit(1);
		return rows[0]?.meaning ?? userName;
	}

	async addBannedGifter(gifterName: string): Promise<void> {
		const broadcaster = this.broadcaster();
		const normalized = normalize(gifterName);
		await this.db
			.insert(bannedGiftersTable)
			.values({ broadcasterName: broadcaster, usernameCanonical: normalized })
			.onConflictDoNothing({ target: [bannedGiftersTable.broadcasterName, bannedGiftersTable.usernameCanonical] });
	}

	async removeBannedGifter(gifterName: string): Promise<boolean> {
		const broadcaster = this.broadcaster();
		const normalized = normalize(gifterName);
		const deleted = await this.db
			.delete(bannedGiftersTable)
			.where(
				and(
					eq(bannedGiftersTable.broadcasterName, broadcaster),
					eq(bannedGiftersTable.usernameCanonical, normalized),
				),
			)
			.returning({ id: bannedGiftersTable.id });
		return deleted.length > 0;
	}

	async isBannedGifter(gifterName: string): Promise<boolean> {
		const broadcaster = this.broadcaster();
		const normalized = normalize(gifterName);
		const rows = await this.db
			.select({ id: bannedGiftersTable.id })
			.from(bannedGiftersTable)
			.where(
				and(
					eq(bannedGiftersTable.broadcasterName, broadcaster),
					eq(bannedGiftersTable.usernameCanonical, normalized),
				),
			)
			.limit(1);
		return rows.length > 0;
	}
}
