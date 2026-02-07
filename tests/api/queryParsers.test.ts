import { describe, expect, it } from 'vitest';
import { parseIntWithBounds, parseOptionalDate, parseOptionalInt } from '../../src/api/http/queryParsers';

describe('queryParsers', () => {
	it('parseIntWithBounds handles fallback and bounds', () => {
		expect(parseIntWithBounds(undefined, 5, 1, 10)).toBe(5);
		expect(parseIntWithBounds('nope', 5, 1, 10)).toBe(5);
		expect(parseIntWithBounds('-2', 5, 1, 10)).toBe(1);
		expect(parseIntWithBounds('200', 5, 1, 10)).toBe(10);
		expect(parseIntWithBounds('7', 5, 1, 10)).toBe(7);
	});

	it('parseOptionalInt handles empty/invalid/valid', () => {
		expect(parseOptionalInt(undefined)).toBeNull();
		expect(parseOptionalInt('abc')).toBeNull();
		expect(parseOptionalInt('42')).toBe(42);
	});

	it('parseOptionalDate handles empty/invalid/valid', () => {
		expect(parseOptionalDate(undefined)).toBeNull();
		expect(parseOptionalDate('bad-date')).toBeNull();
		const value = parseOptionalDate('2026-02-07T00:00:00.000Z');
		expect(value?.toISOString()).toBe('2026-02-07T00:00:00.000Z');
	});
});
