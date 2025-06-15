import { query } from '../utils/DatabaseManager'; // Adjust path as needed

// Original SingleImage type - for reference during mapping
// This type can be removed if it's defined elsewhere or no longer needed after refactoring.
// For now, keeping it for clarity on the 'imageData' parameter.
type SingleImage = {
    image: string; // Assumed to be cloudflare_image_url for now
    analysis: string;
    revisedPrompt: string;
    date: string; // Needs conversion to timestamp
};

export class ImageDataStore {
    constructor() { // filePath parameter removed, no in-memory cache initialization needed here
    }

    // Return type changed to Promise<number | null> (new request_id or null if failed)
    // broadcaster parameter removed
    async storeImageData(user: string, imageData: SingleImage): Promise<number | null> {
        const lowerUser = user.toLowerCase();

        let generationTimestamp: string;
        try {
            // Attempt to parse the date and convert to ISO string.
            // PostgreSQL can usually handle ISO 8601 format directly for TIMESTAMP WITH TIME ZONE.
            generationTimestamp = new Date(imageData.date).toISOString();
        } catch (e) {
            console.warn(`Invalid date format: "${imageData.date}". Using current timestamp for generation_timestamp.`);
            generationTimestamp = new Date().toISOString();
        }

        // These fields are not available in the old SingleImage type, so set to defaults or NULL.
        const triggerEvent = 'legacy_data_import'; // Indicates data imported from the old system
        const success = true; // Assume images stored via this method were successful
        const rawUserInput = null; // Not available
        const openaiRequestPrompt = null; // Not available
        const openaiRequestParameters = null; // Not available as JSONB
        const openaiResponseData = null; // Not available as JSONB
        const generatedImageUrl = null; // Assuming imageData.image is the final Cloudflare URL
        const errorMessage = null; // No error if success is true
        const discordMessageId = null; // Not available

        const sql = `
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

        const params = [
            lowerUser,                  // $1
            imageData.image,            // $2 Mapped to cloudflare_image_url
            imageData.analysis,         // $3
            imageData.revisedPrompt,    // $4
            generationTimestamp,        // $5
            triggerEvent,               // $6
            success,                    // $7
            rawUserInput,               // $8
            openaiRequestPrompt,        // $9
            openaiRequestParameters,    // $10
            openaiResponseData,         // $11
            generatedImageUrl,          // $12
            errorMessage,               // $13
            discordMessageId            // $14
        ];

        try {
            const result = await query(sql, params);
            if (result.rows.length > 0 && result.rows[0].request_id) {
                // Updated console log to remove broadcaster context
                console.log(`Image data for user ${lowerUser} stored in image_generation_logs with request_id: ${result.rows[0].request_id}`);
                return result.rows[0].request_id;
            } else {
                // Updated console log
                console.error(`Failed to store image data for user ${lowerUser}. No request_id returned.`);
                return null;
            }
        } catch (error) {
            // Updated console log
            console.error(`Error saving image data for user ${lowerUser} to database:`, error);
            return null;
        }
    }

    // Future methods for retrieving image data would be added here, e.g.:
    // async getImagesForUser(user: string, broadcaster?: string): Promise<SomeImageType[]>
    // async getImageByRequestId(requestId: number): Promise<SomeImageType | null>
}
