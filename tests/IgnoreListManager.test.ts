import { expect } from 'chai';
import { IgnoreListManager } from '../src/utils/IgnoreListManager';

describe('IgnoreListManager', () => {
	let ignoreListManager: IgnoreListManager;
	const filePath = './ignoreList.json';

	beforeEach(() => {
		ignoreListManager = new IgnoreListManager(filePath);
	});

	it('should add user to ignore list', async () => {
		const username = 'user1';

		await ignoreListManager.addToIgnoreList(username);

		expect(ignoreListManager.isUserIgnored(username)).to.be.true;
	});

	it('should remove user from ignore list', async () => {
		const username = 'user1';
		await ignoreListManager.addToIgnoreList(username);

		await ignoreListManager.removeFromIgnoreList(username);

		expect(ignoreListManager.isUserIgnored(username)).to.be.false;
	});

	it('should check if user is ignored', () => {
		const username = 'user1';
		ignoreListManager.addToIgnoreList(username);

		const result = ignoreListManager.isUserIgnored(username);

		expect(result).to.be.true;
	});
});
