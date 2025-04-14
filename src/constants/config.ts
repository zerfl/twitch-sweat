import { env } from '../env';

export const MAX_RETRIES = env.MAX_RETRIES;

export const MESSAGE_THROTTLE_LIMIT = 20;
export const MESSAGE_THROTTLE_INTERVAL_MS = 30 * 1000;

export const OPENAI_THROTTLE_LIMIT = 500;
export const OPENAI_THROTTLE_INTERVAL_MS = 60 * 1000;

export const DALLE_THROTTLE_LIMIT = env.OPENAI_IMAGES_PER_MINUTE;
export const DALLE_THROTTLE_INTERVAL_MS = 60 * 1000;
