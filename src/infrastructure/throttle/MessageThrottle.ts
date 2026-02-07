import type { MessageThrottleContract } from '../../application/contracts';
import type { ProviderLimiter } from './providerLimiter';

export class MessageThrottle implements MessageThrottleContract {
	constructor(private readonly limiter: ProviderLimiter) {}

	async run<T>(operation: () => Promise<T>): Promise<T> {
		return this.limiter.message(operation);
	}
}
