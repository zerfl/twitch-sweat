// Mock DatabaseManager at the top
const mockQuery = jest.fn();
jest.mock('../src/utils/DatabaseManager', () => ({
    __esModule: true, // This is important for modules mocked with jest.mock
    query: mockQuery,
    getPool: jest.fn(() => ({ // Mock getPool if it's called by any part of the system under test or related scripts
        end: jest.fn(),
    })),
}));

import { BotConfigManager } from '../src/managers/BotConfigManager';

describe('BotConfigManager', () => {
    let manager: BotConfigManager;

    beforeEach(() => {
        mockQuery.mockClear(); // Clear mock usage counts and reset implementations between tests
        manager = new BotConfigManager();
    });

    describe('getConfig', () => {
        it('should retrieve an existing config value from the database', async () => {
            const expectedValue = 'test_value_123';
            const configKey = 'some_api_key';
            mockQuery.mockResolvedValueOnce({ rows: [{ config_value: expectedValue }], rowCount: 1 });

            const value = await manager.getConfig(configKey);

            expect(value).toBe(expectedValue);
            expect(mockQuery).toHaveBeenCalledTimes(1);
            expect(mockQuery).toHaveBeenCalledWith(
                'SELECT config_value FROM bot_configuration WHERE config_key = $1;',
                [configKey]
            );
        });

        it('should return null if the config key does not exist', async () => {
            const configKey = 'non_existent_key';
            mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

            const value = await manager.getConfig(configKey);

            expect(value).toBeNull();
            expect(mockQuery).toHaveBeenCalledTimes(1);
            expect(mockQuery).toHaveBeenCalledWith(
                'SELECT config_value FROM bot_configuration WHERE config_key = $1;',
                [configKey]
            );
        });

        it('should throw an error if the database query fails during getConfig', async () => {
            const configKey = 'any_key';
            const dbError = new Error('Database query failed during getConfig');
            mockQuery.mockRejectedValueOnce(dbError);

            await expect(manager.getConfig(configKey)).rejects.toThrow(dbError);
            expect(mockQuery).toHaveBeenCalledTimes(1);
        });
    });

    describe('setConfig', () => {
        it('should successfully set (insert or update) a config value in the database', async () => {
            const configKey = 'new_app_setting';
            const configValue = 'new_value_for_setting';
            mockQuery.mockResolvedValueOnce({ rowCount: 1 }); // Simulate successful DB operation

            await manager.setConfig(configKey, configValue);

            expect(mockQuery).toHaveBeenCalledTimes(1);
            expect(mockQuery).toHaveBeenCalledWith(
                'INSERT INTO bot_configuration (config_key, config_value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = CURRENT_TIMESTAMP;',
                [configKey, configValue]
            );
        });

        it('should throw an error if setting the config value fails in the database', async () => {
            const configKey = 'another_key';
            const configValue = 'another_value';
            const dbError = new Error('Database insert/update failed during setConfig');
            mockQuery.mockRejectedValueOnce(dbError);

            await expect(manager.setConfig(configKey, configValue)).rejects.toThrow(dbError);
            expect(mockQuery).toHaveBeenCalledTimes(1);
        });
    });

    describe('Twitch Specific Helper Methods', () => {
        const testCases = [
            {
                methodName: 'getTwitchAccessToken',
                configKey: 'twitch_access_token',
                mockValue: 'sample_access_token_value',
                isSetter: false,
            },
            {
                methodName: 'setTwitchAccessToken',
                configKey: 'twitch_access_token',
                valueToSet: 'new_access_token_value',
                isSetter: true,
            },
            {
                methodName: 'getTwitchRefreshToken',
                configKey: 'twitch_refresh_token',
                mockValue: 'sample_refresh_token_value',
                isSetter: false,
            },
            {
                methodName: 'setTwitchRefreshToken',
                configKey: 'twitch_refresh_token',
                valueToSet: 'new_refresh_token_value',
                isSetter: true,
            },
            {
                methodName: 'getTwitchClientId',
                configKey: 'twitch_client_id',
                mockValue: 'sample_client_id_value',
                isSetter: false,
            },
            {
                methodName: 'setTwitchClientId',
                configKey: 'twitch_client_id',
                valueToSet: 'new_client_id_value',
                isSetter: true,
            },
            {
                methodName: 'getTwitchClientSecret',
                configKey: 'twitch_client_secret',
                mockValue: 'sample_client_secret_value',
                isSetter: false,
            },
            {
                methodName: 'setTwitchClientSecret',
                configKey: 'twitch_client_secret',
                valueToSet: 'new_client_secret_value',
                isSetter: true,
            },
        ];

        testCases.forEach(({ methodName, configKey, mockValue, valueToSet, isSetter }) => {
            if (isSetter) {
                it(`${methodName} should call setConfig with "${configKey}" and the provided value`, async () => {
                    const mockSetConfig = jest.spyOn(manager, 'setConfig');
                    // Prevent the actual setConfig (which calls mockQuery) from running,
                    // just ensure it's called correctly by the helper.
                    mockSetConfig.mockResolvedValueOnce(undefined);

                    await (manager as any)[methodName](valueToSet);

                    expect(mockSetConfig).toHaveBeenCalledTimes(1);
                    expect(mockSetConfig).toHaveBeenCalledWith(configKey, valueToSet);

                    mockSetConfig.mockRestore();
                });
            } else {
                it(`${methodName} should call getConfig with "${configKey}" and return its result`, async () => {
                    const mockGetConfig = jest.spyOn(manager, 'getConfig');
                    mockGetConfig.mockResolvedValueOnce(mockValue!); // Mock the underlying getConfig call

                    const result = await (manager as any)[methodName]();

                    expect(mockGetConfig).toHaveBeenCalledTimes(1);
                    expect(mockGetConfig).toHaveBeenCalledWith(configKey);
                    expect(result).toBe(mockValue);

                    mockGetConfig.mockRestore();
                });
            }
        });
    });

    describe('Theme Management Helpers', () => {
        const THEME_CONFIG_KEY = 'current_bot_theme'; // Matches CURRENT_BOT_THEME_KEY in BotConfigManager

        it('getCurrentBotTheme should call getConfig with the correct theme key', async () => {
            const mockGetConfig = jest.spyOn(manager, 'getConfig');
            mockGetConfig.mockResolvedValueOnce('sample_theme'); // Mock getConfig's behavior

            const theme = await manager.getCurrentBotTheme();

            expect(mockGetConfig).toHaveBeenCalledWith(THEME_CONFIG_KEY);
            expect(theme).toBe('sample_theme');

            mockGetConfig.mockRestore();
        });

        it('getCurrentBotTheme should return null if no theme is set', async () => {
            const mockGetConfig = jest.spyOn(manager, 'getConfig');
            mockGetConfig.mockResolvedValueOnce(null);

            const theme = await manager.getCurrentBotTheme();

            expect(mockGetConfig).toHaveBeenCalledWith(THEME_CONFIG_KEY);
            expect(theme).toBeNull();

            mockGetConfig.mockRestore();
        });

        it('setCurrentBotTheme should call setConfig with the correct theme key and value', async () => {
            const mockSetConfig = jest.spyOn(manager, 'setConfig');
            mockSetConfig.mockResolvedValueOnce(undefined); // Mock setConfig's behavior

            await manager.setCurrentBotTheme('new_theme');

            expect(mockSetConfig).toHaveBeenCalledWith(THEME_CONFIG_KEY, 'new_theme');

            mockSetConfig.mockRestore();
        });

        it('setCurrentBotTheme should allow setting an empty string as theme', async () => {
            const mockSetConfig = jest.spyOn(manager, 'setConfig');
            mockSetConfig.mockResolvedValueOnce(undefined);

            await manager.setCurrentBotTheme('');

            expect(mockSetConfig).toHaveBeenCalledWith(THEME_CONFIG_KEY, '');

            mockSetConfig.mockRestore();
        });
    });
});
