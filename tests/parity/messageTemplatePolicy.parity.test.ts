import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import {
	commandAisweatlingIgnored,
	commandAiLastNotFound,
	commandAiLastSummary,
	commandAiLastUnavailable,
	commandAiLastUsage,
	commandAiStatsInvalidWindow,
	commandAiStatsSummary,
	commandAiStatsUnavailable,
	commandAiStatusSummary,
	commandCancelTests,
	commandCurrentTheme,
	commandGifterBanned,
	commandGifterUnbanned,
	commandMeaningGet,
	commandMeaningNotFound,
	commandMeaningRemoved,
	commandMeaningSet,
	commandMyAi,
	commandNeedTestTarget,
	commandNeedTheme,
	commandNeedUsername,
	commandNeedUsernameAndMeaning,
	commandNeedValidTestCount,
	commandNoAi,
	commandNoRunningTests,
	commandNoTheme,
	commandPingPong,
	commandTestAlreadyRunning,
	commandTestStart,
	commandTestStyleError,
	commandTestStyleFailure,
	commandTestSummary,
	commandThemeRemoved,
	commandThemeSet,
	commandYesAi,
	customDiscordFailure,
	customDiscordSuccessBroadcast,
	customTwitchFailure,
	customTwitchSuccessDiscord,
	customTwitchSuccessTwitch,
	discordAnnouncing,
	discordDmNotMonitored,
	discordNeedAnnouncement,
	discordNeedGenerateTargets,
	discordUnknownCommand,
	discordGenerateQueued,
	subscriptionFailure,
	subscriptionSuccessDiscord,
	subscriptionSuccessTwitch,
	testGenerationSuccess,
	testGenerationSuccessDiscord,
} from '../../src/domain/policies/MessageTemplatePolicy';

type Golden = {
	sample: {
		adminUser: string;
		requestUser: string;
		targetUser: string;
		theme: string;
		meaning: string;
		gifter: string;
		style: string;
		imageUrl: string;
	};
	twitchCommands: Record<string, string>;
	twitchEvents: Record<string, string>;
	discordAdmin: Record<string, string>;
};

function loadGolden(): Golden {
	const file = new URL('./golden/typed-baseline.json', import.meta.url);
	return JSON.parse(readFileSync(file, 'utf-8')) as Golden;
}

describe('typed baseline parity: message templates', () => {
	const golden = loadGolden();
	const sample = golden.sample;

	it('matches Twitch command text', () => {
		expect(commandAisweatlingIgnored(sample.requestUser, sample.targetUser)).toBe(golden.twitchCommands.aisweatlingIgnored);
		expect(commandNeedTheme(sample.adminUser)).toBe(golden.twitchCommands.setthemeNeedTheme);
		expect(commandThemeSet(sample.adminUser, sample.theme)).toBe(golden.twitchCommands.setthemeSuccess);
		expect(commandThemeRemoved(sample.adminUser)).toBe(golden.twitchCommands.delthemeSuccess);
		expect(commandNoTheme(sample.adminUser)).toBe(golden.twitchCommands.getthemeNone);
		expect(commandCurrentTheme(sample.adminUser, sample.theme)).toBe(golden.twitchCommands.getthemeCurrent);
		expect(commandNeedUsernameAndMeaning(sample.adminUser)).toBe(golden.twitchCommands.setmeaningNeedArgs);
		expect(commandMeaningSet(sample.adminUser, sample.targetUser)).toBe(golden.twitchCommands.setmeaningSuccess);
		expect(commandNeedUsername(sample.adminUser)).toBe(golden.twitchCommands.delmeaningNeedUsername);
		expect(commandMeaningRemoved(sample.adminUser, sample.targetUser)).toBe(golden.twitchCommands.delmeaningRemoved);
		expect(commandMeaningNotFound(sample.adminUser, sample.targetUser)).toBe(golden.twitchCommands.delmeaningNotFound);
		expect(commandMeaningGet(sample.adminUser, sample.targetUser, sample.meaning)).toBe(golden.twitchCommands.getmeaningSuccess);
		expect(commandNoAi(sample.adminUser)).toBe(golden.twitchCommands.noai);
		expect(commandYesAi(sample.adminUser)).toBe(golden.twitchCommands.yesai);
		expect(commandGifterBanned(sample.adminUser, sample.gifter)).toBe(golden.twitchCommands.bangifterSuccess);
		expect(commandGifterUnbanned(sample.adminUser, sample.gifter)).toBe(golden.twitchCommands.unbangifterSuccess);
		expect(commandPingPong('partyhorst')).toBe(golden.twitchCommands.ping);
		expect(commandMyAi(sample.adminUser)).toBe(golden.twitchCommands.myai);
		expect(commandAiStatusSummary(sample.adminUser, 2, 1, 1, '2m', '45s', 'job-12345... target=Minecraft attempt=3/4 step=job.generation.failed')).toBe(
			golden.twitchCommands.aistatusSummary,
		);
		expect(
			commandAiStatsSummary(
				'viewer',
				'24h',
				8,
				2,
				2,
				1,
				1,
				'80.0',
				'0.4',
				'1.9',
				'custom:6,onSub:3,discord:1',
				's=1200ms,r=800ms,i=4000ms,u=700ms',
			),
		).toBe(golden.twitchCommands.aistats24h);
		expect(commandAiStatsInvalidWindow('viewer')).toBe(golden.twitchCommands.aistatsUsage);
		expect(commandAiStatsUnavailable('viewer')).toBe(golden.twitchCommands.aistatsUnavailable);
		expect(commandAiLastUsage(sample.adminUser)).toBe(golden.twitchCommands.ailastUsage);
		expect(
			commandAiLastSummary(
				sample.adminUser,
				sample.targetUser,
				'job-12345...',
				'failed',
				'custom_twitch',
				'custom',
				'2m',
				'3/4',
				'job.generation.failed',
				'Cloudflare timed out',
				's=1100ms,i=3900ms,u=700ms',
			),
		).toBe(golden.twitchCommands.ailastSummary);
		expect(commandAiLastNotFound(sample.adminUser, sample.targetUser)).toBe(golden.twitchCommands.ailastNotFound);
		expect(commandAiLastUnavailable(sample.adminUser, sample.targetUser)).toBe(golden.twitchCommands.ailastUnavailable);
		expect(commandTestAlreadyRunning(sample.adminUser)).toBe(golden.twitchCommands.testallAlreadyRunning);
		expect(commandNeedTestTarget(sample.adminUser)).toBe(golden.twitchCommands.testallNeedTarget);
		expect(commandNeedValidTestCount(sample.adminUser)).toBe(golden.twitchCommands.testallNeedValidCount);
		expect(commandTestStart(sample.adminUser, sample.targetUser, 1, 1)).toBe(golden.twitchCommands.testallStart);
		expect(commandTestStyleFailure(sample.adminUser, sample.style)).toBe(golden.twitchCommands.testStyleFailure);
		expect(commandTestStyleError(sample.adminUser, sample.style)).toBe(golden.twitchCommands.testStyleError);
		expect(testGenerationSuccess(sample.adminUser, sample.style, sample.imageUrl)).toBe(golden.twitchCommands.testSuccessTwitch);
		expect(testGenerationSuccessDiscord(sample.targetUser, sample.style, sample.imageUrl)).toBe(golden.twitchCommands.testSuccessDiscord);
		expect(commandTestSummary(false, 1, 0, 1, '4.0')).toBe(golden.twitchCommands.testSummaryDiscord);
		expect(`@${sample.adminUser} ${commandTestSummary(false, 1, 0, 1, '4.0')}`).toBe(golden.twitchCommands.testSummaryTwitch);
		expect(commandNoRunningTests(sample.adminUser)).toBe(golden.twitchCommands.noRunningTests);
		expect(commandCancelTests(sample.adminUser)).toBe(golden.twitchCommands.cancelTests);
	});

	it('matches Twitch event and pipeline text', () => {
		expect(subscriptionFailure(sample.targetUser, false)).toBe(golden.twitchEvents.subscriptionFailureSub);
		expect(subscriptionFailure(sample.targetUser, true)).toBe(golden.twitchEvents.subscriptionFailureGift);
		expect(subscriptionSuccessDiscord(sample.targetUser, false, sample.imageUrl)).toBe(golden.twitchEvents.subscriptionSuccessDiscordSub);
		expect(subscriptionSuccessDiscord(sample.targetUser, true, sample.imageUrl)).toBe(golden.twitchEvents.subscriptionSuccessDiscordGift);
		expect(subscriptionSuccessTwitch(sample.targetUser, false, sample.imageUrl)).toBe(golden.twitchEvents.subscriptionSuccessTwitchSub);
		expect(subscriptionSuccessTwitch(sample.targetUser, true, sample.imageUrl)).toBe(golden.twitchEvents.subscriptionSuccessTwitchGift);
		expect(customTwitchFailure(sample.requestUser)).toBe(golden.twitchEvents.customTwitchFailure);
		expect(customTwitchSuccessDiscord(sample.requestUser, sample.targetUser, sample.imageUrl)).toBe(
			golden.twitchEvents.customTwitchSuccessDiscord,
		);
		expect(customTwitchSuccessTwitch(sample.requestUser, sample.targetUser, sample.imageUrl)).toBe(
			golden.twitchEvents.customTwitchSuccessTwitch,
		);
		expect(customDiscordFailure(sample.targetUser)).toBe(golden.twitchEvents.customDiscordFailure);
		expect(customDiscordSuccessBroadcast(sample.targetUser, sample.imageUrl)).toBe(golden.twitchEvents.customDiscordSuccessBroadcast);
	});

	it('matches Discord admin text', () => {
		expect(discordUnknownCommand).toBe(golden.discordAdmin.unknownCommand);
		expect(discordNeedAnnouncement).toBe(golden.discordAdmin.needAnnouncement);
		expect(discordNeedGenerateTargets).toBe(golden.discordAdmin.needGenerateTargets);
		expect(discordAnnouncing('hello chat')).toBe(golden.discordAdmin.announcing);
		expect(discordGenerateQueued(2)).toBe(golden.discordAdmin.queuedTwo);
		expect(discordDmNotMonitored('@admin')).toBe(golden.discordAdmin.dmNotMonitored);
	});
});
