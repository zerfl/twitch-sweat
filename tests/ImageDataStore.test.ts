// Mock DatabaseManager at the top
const mockQuery = jest.fn();
jest.mock('../src/utils/DatabaseManager', () => ({
    __esModule: true, // This is important for modules mocked with jest.mock
    query: mockQuery,
    getPool: jest.fn(() => ({ // Mock getPool if it's called by any part of the system under test or related scripts
        end: jest.fn(),
    })),
}));

import { ImageDataStore } from '../src/managers/ImageDataStore';

// Define the SingleImage type locally for test data, as it might not be exported by the manager.
// This should match the expected input structure for storeImageData's `imageData` parameter.
type SingleImage = {
    image: string;    // Corresponds to cloudflare_image_url
    analysis: string;
    revisedPrompt: string;
    date: string;     // Expected to be a string that can be parsed into a Date
};

describe('ImageDataStore', () => {
    let store: ImageDataStore;

    beforeEach(() => {
        mockQuery.mockClear(); // Clear mock usage counts and reset implementations between tests
        store = new ImageDataStore();
    });

    describe('storeImageData', () => {
        // const sampleBroadcaster = 'TestBroadcaster'; // Removed
        const sampleUser = 'TestUser';
        const validIsoDate = new Date().toISOString();
        const sampleImageData: SingleImage = {
            image: 'https://example.com/image.png',
            analysis: 'This is a sample analysis.',
            revisedPrompt: 'This is a sample revised prompt.',
            date: validIsoDate,
        };

        const expectedSql = `
            INSERT INTO image_generation_logs (
                user_id,                    -- $1
                cloudflare_image_url,       -- $2 (from imageData.image)
                analysis,                   -- $3 (from imageData.analysis)
                revised_prompt,             -- $4 (from imageData.revisedPrompt)
                generation_timestamp,       -- $5
                trigger_event,              -- $6
                success,                    -- $7
                raw_user_input,             -- $8
                openai_request_prompt,      -- $9
                openai_request_parameters,  -- $10
                openai_response_data,       -- $11
                generated_image_url,        -- $12
                error_message,              -- $13
                discord_message_id          -- $14
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING request_id;
        `; // broadcaster_id column and its parameter are removed. $n placeholders adjusted.

        it('should correctly insert image data and return request_id on success', async () => {
            const expectedRequestId = 123;
            mockQuery.mockResolvedValueOnce({ rows: [{ request_id: expectedRequestId }], rowCount: 1 });

            // Call without sampleBroadcaster
            const requestId = await store.storeImageData(sampleUser, sampleImageData);

            expect(requestId).toBe(expectedRequestId);
            expect(mockQuery).toHaveBeenCalledTimes(1);

            const [sql, params] = mockQuery.mock.calls[0];
            // Normalize whitespace in SQL for comparison
            expect(sql.replace(/\s+/g, ' ')).toBe(expectedSql.replace(/\s+/g, ' '));

            expect(params).toEqual([
                sampleUser.toLowerCase(),           // $1 user_id
                sampleImageData.image,              // $2 cloudflare_image_url
                sampleImageData.analysis,           // $3
                sampleImageData.revisedPrompt,      // $4
                validIsoDate,                       // $5 (already an ISO string)
                'legacy_data_import',               // $6
                true,                               // $7 success
                null,                               // $8 raw_user_input
                null,                               // $9 openai_request_prompt
                null,                               // $10 openai_request_parameters
                null,                               // $11 openai_response_data
                null,                               // $12 generated_image_url
                null,                               // $13 error_message
                null,                               // $14 discord_message_id
            ]);
        });

        it('should return null if database insert fails or returns no request_id', async () => {
            mockQuery.mockRejectedValueOnce(new Error('DB insert failed'));
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            // Call without sampleBroadcaster
            let requestId = await store.storeImageData(sampleUser, sampleImageData);
            expect(requestId).toBeNull();
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Error saving image data'), expect.any(Error));

            mockQuery.mockClear(); // Clear previous mockRejectedValueOnce
            consoleErrorSpy.mockClear();

            // Test case where DB operation succeeds but returns no rows/request_id
            mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
             // Call without sampleBroadcaster
            requestId = await store.storeImageData(sampleUser, sampleImageData);
            expect(requestId).toBeNull();
            expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to store image data'));

            consoleErrorSpy.mockRestore();
        });

        it('should use current timestamp if provided date string is invalid', async () => {
            const invalidDateImageData: SingleImage = { ...sampleImageData, date: 'this-is-not-a-date' };
            const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

            const expectedRequestId = 456;
            mockQuery.mockResolvedValueOnce({ rows: [{ request_id: expectedRequestId }], rowCount: 1 });

             // Call without sampleBroadcaster
            const requestId = await store.storeImageData(sampleUser, invalidDateImageData);
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid date format: "this-is-not-a-date"'));

            const params = mockQuery.mock.calls[0][1];
            // Parameter indexing changes because broadcaster_id was removed.
            // user_id ($1), image ($2), analysis ($3), revisedPrompt ($4), timestamp ($5)
            const timestampParam = params[4];

            expect(typeof timestampParam).toBe('string');
            const parsedTimestamp = new Date(timestampParam);
            expect(parsedTimestamp.toString()).not.toBe('Invalid Date');
            // Check if it's very close to the current time (e.g., within a few seconds)
            expect(Math.abs(parsedTimestamp.getTime() - Date.now())).toBeLessThan(5000); // Within 5 seconds

            consoleWarnSpy.mockRestore();
        });

        it('should use a valid but differently formatted date string correctly', async () => {
            const specificDate = new Date(2023, 0, 15, 12, 30, 0); // Jan 15, 2023, 12:30:00
            const nonIsoDateData: SingleImage = { ...sampleImageData, date: specificDate.toUTCString() }; // e.g., "Sun, 15 Jan 2023 12:30:00 GMT"

            const expectedRequestId = 789;
            mockQuery.mockResolvedValueOnce({ rows: [{ request_id: expectedRequestId }], rowCount: 1 });

            // Call without sampleBroadcaster
            const requestId = await store.storeImageData(sampleUser, nonIsoDateData);

            expect(requestId).toBe(expectedRequestId);
            expect(mockQuery).toHaveBeenCalledTimes(1);

            const params = mockQuery.mock.calls[0][1];
            // Parameter indexing changes: timestamp is now $5 (index 4)
            const timestampParam = params[4];

            expect(new Date(timestampParam).toISOString()).toBe(specificDate.toISOString());
        });
    });
});
