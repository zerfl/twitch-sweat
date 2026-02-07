import { describe, expect, it } from 'vitest';
import { getVerbFromTrigger } from '../../src/domain/policies/TriggerPolicy';

describe('getVerbFromTrigger', () => {
	it('returns gifting when gifting flag is true', () => {
		expect(getVerbFromTrigger({ isGifting: true })).toBe('gifting');
	});

	it('returns subscribing for non-gifting flow', () => {
		expect(getVerbFromTrigger({ isGifting: false })).toBe('subscribing');
		expect(getVerbFromTrigger({})).toBe('subscribing');
	});
});
