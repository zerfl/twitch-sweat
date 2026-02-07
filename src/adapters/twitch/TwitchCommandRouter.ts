import { createBotCommand, type BotCommand } from '@twurple/easy-bot';
import type { HandleTwitchCommandUseCase, TwitchCommandExecutionContext } from '../../application/usecases/HandleTwitchCommandUseCase';

const COMMANDS = [
	'aisweatling',
	'settheme',
	'deltheme',
	'gettheme',
	'setmeaning',
	'delmeaning',
	'getmeaning',
	'noai',
	'yesai',
	'bangifter',
	'unbangifter',
	'ping',
	'say',
	'uguu',
	'quack',
	'myai',
	'aistatus',
	'aistats',
	'ailast',
	'testall',
	'canceltests',
] as const;

export class TwitchCommandRouter {
	constructor(private readonly handleTwitchCommandUseCase: HandleTwitchCommandUseCase) {}

	createCommands(): BotCommand[] {
		return COMMANDS.map((command) => {
			return createBotCommand(command, async (params, ctx) => {
				const commandContext: TwitchCommandExecutionContext = {
					userName: ctx.userName,
					broadcasterName: ctx.broadcasterName,
					say: ctx.say,
				};
				await this.handleTwitchCommandUseCase.execute(command, params, commandContext);
			});
		});
	}
}
