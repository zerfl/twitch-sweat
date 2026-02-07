import { eq } from 'drizzle-orm';
import type { DbClient } from '../db/client';
import { appConfigTable } from '../db/schema';

export class AppConfigRepository {
	constructor(private readonly db: DbClient) {}

	async ensureBroadcaster(broadcasterName: string): Promise<void> {
		const normalized = broadcasterName.toLowerCase();
		const existing = await this.db
			.select({ id: appConfigTable.id })
			.from(appConfigTable)
			.where(eq(appConfigTable.id, 1))
			.limit(1);
		if (existing.length > 0) {
			await this.db.update(appConfigTable).set({ broadcasterName: normalized, updatedAt: new Date() }).where(eq(appConfigTable.id, 1));
			return;
		}
		await this.db.insert(appConfigTable).values({ id: 1, broadcasterName: normalized });
	}

	async getBroadcasterName(): Promise<string | null> {
		const rows = await this.db.select().from(appConfigTable).where(eq(appConfigTable.id, 1)).limit(1);
		return rows[0]?.broadcasterName ?? null;
	}
}
