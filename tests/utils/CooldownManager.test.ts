import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CooldownManager } from '../../src/utils/CooldownManager';

describe('CooldownManager', () => {
	let cooldownManager: CooldownManager;

	beforeEach(() => {
		cooldownManager = new CooldownManager(10, 5);
		vi.spyOn(cooldownManager, 'saveCooldowns').mockResolvedValue();
	});

	it('returns empty string when no cooldowns are active', () => {
		const result = cooldownManager.checkCooldowns('user1', 'broadcaster1');
		expect(result).toBe('');
	});

	it('returns global cooldown message when global cooldown is active', () => {
		cooldownManager.setGlobalCooldown('broadcaster1', Date.now() - 5_000);
		const result = cooldownManager.checkCooldowns('user1', 'broadcaster1');
		expect(result).toContain('This command is on cooldown');
	});

	it('returns user cooldown message when user cooldown is active', () => {
		cooldownManager.setUserCooldown('broadcaster1', 'user1', Date.now() - 2_000);
		const result = cooldownManager.checkCooldowns('user1', 'broadcaster1');
		expect(result).toContain('You are on cooldown');
	});
});
