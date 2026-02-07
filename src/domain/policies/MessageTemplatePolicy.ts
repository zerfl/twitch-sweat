import { getVerbFromTrigger } from './TriggerPolicy';

export function subscriptionFailure(userName: string, isGifting: boolean): string {
	const verb = getVerbFromTrigger(isGifting ? { isGifting: true } : {});
	return `Thank you @${userName} for ${verb} dnkLove Unfortunately, I was unable to generate an image for you.`;
}

export function subscriptionSuccessDiscord(userName: string, isGifting: boolean, imageUrl: string): string {
	const verb = getVerbFromTrigger(isGifting ? { isGifting: true } : {});
	return `Thank you \`${userName}\` for ${verb}. Here's your sweatling: ${imageUrl}`;
}

export function subscriptionSuccessTwitch(userName: string, isGifting: boolean, imageUrl: string): string {
	const verb = getVerbFromTrigger(isGifting ? { isGifting: true } : {});
	return `Thank you @${userName} for ${verb} dnkLove This is for you: ${imageUrl}`;
}

export function customTwitchFailure(requestUserName: string): string {
	return `Sorry, ${requestUserName}, I was unable to generate an image for you.`;
}

export function customTwitchSuccessDiscord(requestUserName: string, targetDisplayName: string, imageUrl: string): string {
	return `@${requestUserName} requested generation for \`${targetDisplayName}\`. Here's the sweatling: ${imageUrl}`;
}

export function customTwitchSuccessTwitch(requestUserName: string, targetDisplayName: string, imageUrl: string): string {
	return `@${requestUserName} requested generation for @${targetDisplayName}. Here's the sweatling: ${imageUrl}`;
}

export function customDiscordFailure(targetDisplayName: string): string {
	return `Unable to generate image for ${targetDisplayName}`;
}

export function customDiscordSuccessBroadcast(targetDisplayName: string, imageUrl: string): string {
	return `Thank you \`${targetDisplayName}\` for subscribing. Here's your sweatling: ${imageUrl}`;
}

export function testGenerationSuccess(requestUserName: string, styleKeyword: string, imageUrl: string): string {
	return `@${requestUserName} Test image for style ${styleKeyword}: ${imageUrl}`;
}

export function testGenerationSuccessDiscord(targetDisplayName: string, styleKeyword: string, imageUrl: string): string {
	return `Test image for \`${targetDisplayName}\` using style ${styleKeyword}: ${imageUrl}`;
}

export function commandNoAi(userName: string): string {
	return `@${userName} You will no longer receive AI sweatlings`;
}

export function commandYesAi(userName: string): string {
	return `@${userName} You will now receive AI sweatlings`;
}

export function commandNeedTheme(userName: string): string {
	return `@${userName} Please provide a theme.`;
}

export function commandThemeSet(userName: string, theme: string): string {
	return `@${userName} Theme set to: ${theme}`;
}

export function commandThemeRemoved(userName: string): string {
	return `@${userName} Theme removed.`;
}

export function commandNoTheme(userName: string): string {
	return `@${userName} No theme set.`;
}

export function commandCurrentTheme(userName: string, theme: string): string {
	return `@${userName} Current theme: ${theme}`;
}

export function commandNeedUsernameAndMeaning(userName: string): string {
	return `@${userName} Please provide a username and a meaning.`;
}

export function commandMeaningSet(userName: string, targetUser: string): string {
	return `@${userName} Meaning for ${targetUser} set.`;
}

export function commandNeedUsername(userName: string): string {
	return `@${userName} Please provide a username.`;
}

export function commandMeaningRemoved(userName: string, targetUser: string): string {
	return `@${userName} Meaning for ${targetUser} removed.`;
}

export function commandMeaningNotFound(userName: string, targetUser: string): string {
	return `@${userName} Meaning for ${targetUser} not found.`;
}

export function commandMeaningGet(userName: string, targetUser: string, meaning: string): string {
	return `@${userName} ${targetUser} means '${meaning}' dnkNoted`;
}

export function commandGifterBanned(userName: string, gifterName: string): string {
	return `@${userName} Gifter ${gifterName} banned. Sub gifts from this user will be ignored.`;
}

export function commandGifterUnbanned(userName: string, gifterName: string): string {
	return `@${userName} Gifter ${gifterName} unbanned.`;
}

export function commandPingPong(userName: string): string {
	return `@${userName} pong`;
}

export function commandMyAi(userName: string): string {
	return `@${userName} Check your sweatlings at https://www.curvyspiderwife.com/user/${userName} or in Discord dnkLove`;
}

export function commandAiStatusSummary(
	userName: string,
	pendingCount: number,
	readyPendingCount: number,
	processingCount: number,
	oldestPendingAge: string,
	longestRunAge: string,
	sample: string,
): string {
	return (
		`@${userName} AI status: q=${pendingCount} rdy=${readyPendingCount} proc=${processingCount} ` +
		`oldestQ=${oldestPendingAge} longestRun=${longestRunAge} sample=${sample}`
	);
}

export function commandAiStatsSummary(
	userName: string,
	window: string,
	succeededCount: number,
	failedCount: number,
	pendingCount: number,
	readyPendingCount: number,
	processingCount: number,
	successRate: string,
	completedPerHour: string,
	averageAttempts: string,
	topTriggers: string,
	latencySummary: string,
): string {
	const successRateToken = successRate === 'n/a' ? 'n/a' : `${successRate}%`;
	return (
		`@${userName} AI stats(${window}): ok=${succeededCount} fail=${failedCount} ` +
		`q=${pendingCount} rdy=${readyPendingCount} proc=${processingCount} sr=${successRateToken} ` +
		`thr=${completedPerHour}/h att=${averageAttempts} trig=${topTriggers} lat=${latencySummary}`
	);
}

export function commandAiStatsInvalidWindow(userName: string): string {
	return `@${userName} Usage: !aistats [1h|24h|7d]`;
}

export function commandAiStatsUnavailable(userName: string): string {
	return `@${userName} AI stats unavailable right now.`;
}

export function commandAiLastUsage(userName: string): string {
	return `@${userName} Usage: !ailast <username>`;
}

export function commandAiLastNotFound(userName: string, targetUserName: string): string {
	return `@${userName} No generations found for ${targetUserName}.`;
}

export function commandAiLastSummary(
	userName: string,
	targetUserName: string,
	jobId: string,
	status: string,
	kind: string,
	trigger: string,
	age: string,
	attemptProgress: string,
	step: string,
	errorToken: string,
	latencySummary: string,
): string {
	return (
		`@${userName} AI last ${targetUserName}: job=${jobId} st=${status} kind=${kind} trig=${trigger} ` +
		`age=${age} att=${attemptProgress} step=${step} err=${errorToken} lat=${latencySummary}`
	);
}

export function commandAiLastUnavailable(userName: string, targetUserName: string): string {
	return `@${userName} Unable to fetch last generation stats for ${targetUserName} right now.`;
}

export function commandAisweatlingIgnored(requestUserName: string, targetUserName: string): string {
	return `@${requestUserName} ${targetUserName} does not partake in ai sweatlings.`;
}

export function commandTestAlreadyRunning(userName: string): string {
	return `@${userName} A test generation is already running. Use !canceltests to stop it.`;
}

export function commandNeedTestTarget(userName: string): string {
	return `@${userName} Please provide a username to test with.`;
}

export function commandNeedValidTestCount(userName: string): string {
	return `@${userName} Please provide a valid number of images to generate.`;
}

export function commandTestStart(userName: string, targetUserName: string, count: number, totalTasks: number): string {
	return `@${userName} Starting test generation for ${targetUserName} with ${count} image(s) per style. Total images: ${totalTasks}`;
}

export function commandTestStyleFailure(userName: string, styleKeyword: string): string {
	return `@${userName} Failed to generate image for style ${styleKeyword}`;
}

export function commandTestStyleError(userName: string, styleKeyword: string): string {
	return `@${userName} Error generating image for style ${styleKeyword}`;
}

export function commandTestSummary(
	wasCancelled: boolean,
	successCount: number,
	failureCount: number,
	totalTasks: number,
	totalSeconds: string,
): string {
	return (
		`Test generation ${wasCancelled ? 'cancelled' : 'complete'}. ` +
		`Success: ${successCount}, Failures: ${failureCount}, ` +
		`Total: ${successCount + failureCount}/${totalTasks}. ` +
		`Time taken: ${totalSeconds}s`
	);
}

export function commandNoRunningTests(userName: string): string {
	return `@${userName} No test generation is currently running.`;
}

export function commandCancelTests(userName: string): string {
	return `@${userName} Cancelling test generation after current tasks complete...`;
}

export function discordDmNotMonitored(adminRef: string): string {
	return `This communication channel is not monitored. Please contact ${adminRef} directly.`;
}

export const discordUnknownCommand = 'Unknown command.';
export const discordNeedAnnouncement = 'Please provide an announcement.';
export const discordNeedGenerateTargets = 'Please provide one or more usernames.';

export function discordAnnouncing(message: string): string {
	return `Announcing: ${message}`;
}

export function discordGenerateFailure(target: string): string {
	return `Unable to generate image for ${target}`;
}

export function discordGenerateQueued(count: number): string {
	return `Queued ${count} generation request(s).`;
}
