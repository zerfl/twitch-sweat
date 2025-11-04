/**
 * Test Data Fixtures
 *
 * Provides sample data for testing image generation, commands, and events.
 */

export const TestUsers = {
	regular: {
		username: 'testuser123',
		displayName: 'TestUser123',
		toLowerCase: () => 'testuser123'
	},
	admin: {
		username: 'adminuser',
		displayName: 'AdminUser',
		toLowerCase: () => 'adminuser'
	},
	broadcaster: {
		username: 'curvyspiderwife',
		displayName: 'CurvySpiderWife',
		toLowerCase: () => 'curvyspiderwife'
	},
	gifter: {
		username: 'gifterguy',
		displayName: 'GifterGuy',
		toLowerCase: () => 'gifterguy'
	}
};

export const TestChannels = {
	primary: 'curvyspiderwife',
	secondary: 'testchannel'
};

export const TestThemes = {
	underwater: 'underwater ocean theme with fish and coral',
	space: 'outer space with stars and planets',
	forest: 'enchanted forest with magical creatures'
};

export const TestMeanings = {
	'partyhorst': 'A festive horse that loves celebrations',
	'zerfl': 'A mysterious digital entity',
	'testuser123': 'A user who loves testing'
};

export const TestStyles = [
	'oil',
	'watercolor',
	'pixel',
	'glitch',
	'neon',
	'baroque'
];

export const MockImageData = {
	url: 'https://example.com/generated-image.png',
	revisedPrompt: 'A cute blue round-faced avatar with blue skin...',
	analysis: JSON.stringify({
		step1: {
			reasoning: 'Test reasoning',
			interpretation: 'Test interpretation'
		},
		step2: {
			avatar_details: {
				facial_expression: 'happy',
				distinctive_features: 'blue skin'
			}
		}
	}, null, 2)
};

export const MockCloudflareResponse = {
	success: true,
	result: {
		id: 'test-image-id-12345',
		filename: 'test-image.png',
		uploaded: new Date().toISOString(),
		requireSignedURLs: false,
		variants: []
	},
	errors: [],
	messages: []
};

export const MockOpenAIAnalysis = {
	step1: {
		reasoning: 'The username suggests a user interested in testing and quality assurance',
		interpretation: 'A diligent tester avatar'
	},
	step2: {
		avatar_details: {
			facial_expression: 'focused and determined',
			distinctive_features: 'wearing testing goggles, blue skin',
			pose: 'sitting at computer'
		},
		objects: ['keyboard', 'test reports', 'bug magnifying glass'],
		scene: {
			setting: 'modern office',
			mood: 'professional',
			lighting: 'bright fluorescent'
		}
	}
};

export const MockEventData = {
	subscription: {
		broadcasterName: TestChannels.primary,
		userName: TestUsers.regular.username,
		userDisplayName: TestUsers.regular.displayName,
		isGifting: false
	},
	gift: {
		broadcasterName: TestChannels.primary,
		userName: TestUsers.regular.username,
		userDisplayName: TestUsers.regular.displayName,
		gifterName: TestUsers.gifter.username,
		gifterDisplayName: TestUsers.gifter.displayName,
		isGifting: true
	},
	communityGift: {
		broadcasterName: TestChannels.primary,
		gifterName: TestUsers.gifter.username,
		gifterDisplayName: TestUsers.gifter.displayName
	}
};

export const MockCommandContext = {
	params: [] as string[],
	userName: TestUsers.regular.username,
	userDisplayName: TestUsers.regular.displayName,
	broadcasterName: TestChannels.primary,
	say: async (message: string) => { console.log(`[MOCK SAY] ${message}`); }
};

/**
 * Helper to create command context with custom values
 */
export function createCommandContext(overrides: Partial<typeof MockCommandContext> = {}) {
	return {
		...MockCommandContext,
		...overrides,
		params: overrides.params || []
	};
}

/**
 * Helper to create event data with custom values
 */
export function createEventData(type: 'subscription' | 'gift' | 'communityGift', overrides: any = {}) {
	return {
		...MockEventData[type],
		...overrides
	};
}
