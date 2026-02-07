import { describe, expect, it } from 'vitest';
import { evaluateRetry } from '../../src/domain/policies/RetryPolicy';

describe('evaluateRetry', () => {
	it('retries while current attempt count is below max retries', () => {
		const decision = evaluateRetry(1, 3);
		expect(decision.shouldRetry).toBe(true);
		expect(decision.nextAttempt).toBe(2);
	});

	it('stops retrying when max retries reached', () => {
		const decision = evaluateRetry(3, 3);
		expect(decision.shouldRetry).toBe(false);
		expect(decision.nextAttempt).toBe(4);
	});
});
