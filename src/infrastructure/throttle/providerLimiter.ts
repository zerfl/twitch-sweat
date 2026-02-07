import throttledQueue from 'throttled-queue';
import {
	DALLE_THROTTLE_INTERVAL_MS,
	DALLE_THROTTLE_LIMIT,
	MESSAGE_THROTTLE_INTERVAL_MS,
	MESSAGE_THROTTLE_LIMIT,
	OPENAI_THROTTLE_INTERVAL_MS,
	OPENAI_THROTTLE_LIMIT,
} from '../../constants/config';

export class ProviderLimiter {
	readonly message = throttledQueue(MESSAGE_THROTTLE_LIMIT, MESSAGE_THROTTLE_INTERVAL_MS, true);
	readonly openai = throttledQueue(OPENAI_THROTTLE_LIMIT, OPENAI_THROTTLE_INTERVAL_MS, true);
	readonly image = throttledQueue(DALLE_THROTTLE_LIMIT, DALLE_THROTTLE_INTERVAL_MS, true);
}
