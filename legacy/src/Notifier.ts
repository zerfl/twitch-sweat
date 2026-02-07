export interface TwitchNotifier {
	say(message: string): Promise<void>;
}

export interface DiscordNotifier {
	sendToAllChannels(message: string): Promise<void>;
	sendToChannel(channelId: string, message: string): Promise<void>;
}
