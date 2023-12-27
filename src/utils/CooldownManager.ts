import { PathLike, promises as fs } from 'fs';

type GlobalCooldownMap = Map<string, number>;
type UserMap = Map<string, number>;
type UserCooldownMap = Map<string, UserMap>;

type SavedCooldownMaps = {
	globalCooldownMap: { broadcaster: string; timestamp: number }[];
	userCooldownMap: {
		broadcaster: string;
		users: { user: string; timestamp: number }[];
	}[];
};

export class CooldownManager {
	private globalCooldownMap: GlobalCooldownMap;
	private userCooldownMap: UserCooldownMap;
	private readonly userCooldownInSeconds: number;
	private readonly globalCooldownInSeconds: number;

	constructor(globalCooldownInSeconds: number, userCooldownInSeconds: number) {
		this.globalCooldownMap = new Map();
		this.userCooldownMap = new Map();
		this.userCooldownInSeconds = userCooldownInSeconds;
		this.globalCooldownInSeconds = globalCooldownInSeconds;
	}

	public checkCooldowns = (user: string, broadcasterName: string): string => {
		this.saveCooldowns('./cooldowns.json');
		const now = Date.now();

		const globalCooldownRemaining = this.checkGlobalCooldown(
			now,
			broadcasterName,
		);
		if (globalCooldownRemaining > 0) {
			return `This command is on cooldown. Time remaining: ${globalCooldownRemaining}s`;
		}

		const userCooldownRemaining = this.checkUserCooldown(
			now,
			user,
			broadcasterName,
		);
		if (userCooldownRemaining > 0) {
			return `You are on cooldown. Time remaining: ${userCooldownRemaining}s`;
		}

		return '';
	};

	public checkGlobalCooldown(now: number, broadcasterName: string): number {
		const lastGlobalRequest = this.globalCooldownMap.get(broadcasterName) || 0;
		return Math.round(
			this.globalCooldownInSeconds - (now - lastGlobalRequest) / 1000,
		);
	}

	public checkUserCooldown(
		now: number,
		user: string,
		broadcasterName: string,
	): number {
		const userLastRequestMap =
			this.userCooldownMap.get(broadcasterName) || new Map();
		const lastUserRequest = userLastRequestMap.get(user) || 0;
		return Math.round(
			this.userCooldownInSeconds - (now - lastUserRequest) / 1000,
		);
	}

	public setGlobalCooldown(broadcasterName: string, timestamp: number) {
		this.globalCooldownMap.set(broadcasterName, timestamp);
	}

	public setUserCooldown(
		broadcasterName: string,
		user: string,
		timestamp: number,
	) {
		const userLastRequestMap =
			this.userCooldownMap.get(broadcasterName) || new Map();
		userLastRequestMap.set(user, timestamp);
		this.userCooldownMap.set(broadcasterName, userLastRequestMap);
	}

	public async saveCooldowns(filePath: PathLike) {
		const cooldowns: SavedCooldownMaps = {
			globalCooldownMap: Array.from(this.globalCooldownMap).map(
				([key, value]) => ({ broadcaster: key, timestamp: value }),
			),
			userCooldownMap: Array.from(this.userCooldownMap).map(
				([broadcasterName, userMap]) => ({
					broadcaster: broadcasterName,
					users: Array.from(userMap).map(([userName, timestamp]) => ({
						user: userName,
						timestamp: timestamp,
					})),
				}),
			),
		};

		await fs.writeFile(filePath, JSON.stringify(cooldowns, null, 4), 'utf-8');
	}
}
