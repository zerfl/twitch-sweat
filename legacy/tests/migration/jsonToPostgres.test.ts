import { describe, expect, it } from 'vitest';
import {
	buildMigrationResult,
	parseLegacyImagesFile,
	parseLegacyTokensFile,
} from '../../src/migration/jsonToPostgres';

describe('jsonToPostgres migration', () => {
	it('maps legacy images and settings into normalized rows', () => {
		const result = buildMigrationResult({
			images: {
				StreamerA: {
					UserOne: [
						{
							image: 'https://example.com/a.png',
							analysis: 'ok',
							revisedPrompt: 'prompt v1',
							date: '2026-02-07T00:00:00.000Z',
						},
					],
				},
			},
			meanings: { UserOne: 'first user' },
			themes: { StreamerA: 'winter' },
			ignore: ['IgnoredUser'],
			bannedGifters: { StreamerA: ['BadGifter'] },
			tokens: {
				accessToken: 'a',
				refreshToken: 'b',
				scope: ['chat:read'],
				expiresIn: 10,
				obtainmentTimestamp: 20,
			},
		});

		expect(result.report.counts.broadcasters).toBe(1);
		expect(result.report.counts.users).toBe(3);
		expect(result.report.counts.imageGenerations).toBe(1);
		expect(result.payload.imageGenerations[0]?.finalPrompt).toBe('prompt v1');
		expect(result.report.counts.hasTokens).toBe(true);
	});

	it('skips invalid dates and reports warnings', () => {
		const result = buildMigrationResult({
			images: {
				StreamerA: {
					UserOne: [
						{
							image: 'https://example.com/a.png',
							analysis: 'Literal username: x\n[object Object]',
							prompt: 'p',
							date: 'not-a-date',
						},
					],
				},
			},
			meanings: {},
			themes: {},
			ignore: [],
			bannedGifters: {},
			tokens: {},
		});

		expect(result.report.counts.imageGenerations).toBe(0);
		expect(result.report.warnings.length).toBeGreaterThan(0);
		expect(result.report.counts.hasTokens).toBe(false);
	});

	it('validates input schemas', () => {
		const parsed = parseLegacyImagesFile({
			streamer: {
				user: [
					{
						image: 'https://example.com/x.png',
						date: '2026-02-07T00:00:00.000Z',
					},
				],
			},
		});
		expect(parsed.streamer?.user).toHaveLength(1);

		const tokens = parseLegacyTokensFile({ accessToken: 'a' });
		expect(tokens.accessToken).toBe('a');
	});

	it('reports skipped rows for empty normalized values', () => {
		const result = buildMigrationResult({
			images: {
				'   ': {
					user: [],
				},
				streamer: {
					'   ': [
						{
							image: 'https://example.com/a.png',
							date: '2026-02-07T00:00:00.000Z',
						},
					],
				},
			},
			meanings: { '   ': 'ignored' },
			themes: { '   ': 'ignored' },
			ignore: ['   '],
			bannedGifters: { '   ': ['x'], streamer: ['   '] },
			tokens: {},
		});

		expect(result.report.warnings.length).toBeGreaterThan(0);
		expect(result.payload.imageGenerations).toHaveLength(0);
	});
});
