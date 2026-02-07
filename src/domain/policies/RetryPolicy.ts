export interface RetryDecision {
	shouldRetry: boolean;
	nextAttempt: number;
	nextRunAt: Date;
}

export function evaluateRetry(currentAttemptCount: number, maxRetries: number): RetryDecision {
	const nextAttempt = currentAttemptCount + 1;
	if (currentAttemptCount >= maxRetries) {
		return {
			shouldRetry: false,
			nextAttempt,
			nextRunAt: new Date(),
		};
	}

	return {
		shouldRetry: true,
		nextAttempt,
		nextRunAt: new Date(),
	};
}
