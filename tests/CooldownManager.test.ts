import { expect } from 'chai';
import { CooldownManager } from '../src/utils/CooldownManager';

describe('CooldownManager', () => {
	let cooldownManager: CooldownManager;

	beforeEach(() => {
		cooldownManager = new CooldownManager(10, 5);
	});

	describe('checkCooldowns', () => {
		it('returns empty string when no cooldowns are active', () => {
			const result = cooldownManager.checkCooldowns('user1', 'broadcaster1');
			expect(result).to.equal('');
		});

		it('returns global cooldown message when global cooldown is active', () => {
			cooldownManager.setGlobalCooldown('broadcaster1', Date.now() - 5000);
			const result = cooldownManager.checkCooldowns('user1', 'broadcaster1');
			expect(result).to.include('This command is on cooldown');
		});

		it('returns user cooldown message when user cooldown is active', () => {
			cooldownManager.setUserCooldown(
				'broadcaster1',
				'user1',
				Date.now() - 2000,
			);
			const result = cooldownManager.checkCooldowns('user1', 'broadcaster1');
			expect(result).to.include('You are on cooldown');
		});
	});
});
