export function isAdminOrBroadcaster(userName: string, broadcasterName: string, twitchAdmins: Set<string>): boolean {
	const lowerUserName = userName.toLowerCase();
	const lowerBroadcasterName = broadcasterName.toLowerCase();
	const adminList = [...Array.from(twitchAdmins), lowerBroadcasterName];
	return adminList.includes(lowerUserName);
}
