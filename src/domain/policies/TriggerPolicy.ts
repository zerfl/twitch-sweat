export interface SubscriptionTriggerContext {
	isGifting?: boolean;
}

export function getVerbFromTrigger(ctx: SubscriptionTriggerContext): 'subscribing' | 'gifting' {
	return ctx.isGifting ? 'gifting' : 'subscribing';
}
