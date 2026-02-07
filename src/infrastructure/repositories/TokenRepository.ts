import type { AccessToken } from '@twurple/auth';
import { desc } from 'drizzle-orm';
import type { DbClient } from '../db/client';
import { twitchTokensTable } from '../db/schema';

export class TokenRepository {
	constructor(private readonly db: DbClient) {}

	async getLatestToken(): Promise<AccessToken | null> {
		const rows = await this.db
			.select()
			.from(twitchTokensTable)
			.orderBy(desc(twitchTokensTable.updatedAt))
			.limit(1);
		const token = rows[0];
		if (!token) {
			return null;
		}

		return {
			accessToken: token.accessToken,
			refreshToken: token.refreshToken,
			expiresIn: token.expiresIn,
			obtainmentTimestamp: token.obtainmentTimestamp,
			scope: token.scope,
		};
	}

	async upsertToken(token: AccessToken): Promise<void> {
		await this.db.insert(twitchTokensTable).values({
			accessToken: token.accessToken,
			refreshToken: token.refreshToken ?? null,
			expiresIn: token.expiresIn ?? null,
			obtainmentTimestamp: token.obtainmentTimestamp,
			scope: [...token.scope],
			updatedAt: new Date(),
		});
	}
}
