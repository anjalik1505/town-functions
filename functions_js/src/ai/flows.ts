import { googleAI } from '@genkit-ai/googleai';
import { defineSecret } from 'firebase-functions/params';
import { genkit } from 'genkit';
import { getLogger } from '../utils/logging-utils';

const logger = getLogger(__filename);

// Define the API key secret for Gemini
export const geminiApiKey = defineSecret("GEMINI_API_KEY");

// Configure a Genkit instance with the prompts directory
const ai = genkit({
    plugins: [googleAI({
        // Don't access the secret value during initialization
        // It will be accessed at runtime in the flow functions
        apiKey: process.env.GEMINI_API_KEY || "API_KEY_PLACEHOLDER"
    })],
});

// Default configuration for AI calls
const globalConfig = {
    maxOutputTokens: 1000,
    temperature: 0.0,
};

/**
 * Generate creator profile insights based on updates
 */
export async function generateCreatorProfileFlow(params: {
    existingSummary: string;
    existingSuggestions: string;
    existingEmotionalOverview: string;
    existingKeyMoments: string;
    existingRecurringThemes: string;
    existingProgressAndGrowth: string;
    updateContent: string;
    sentiment: string;
}) {
    logger.info(`Generating creator profile insights for update: ${JSON.stringify(params, null, 2)}`);
    // Initialize with existing data as default values
    let success = false;
    let retryCount = 0;
    const maxRetries = 3;

    // Configure with the actual API key at runtime
    const config = {
        apiKey: process.env.GEMINI_API_KEY ||
            (typeof geminiApiKey.value === 'function' ? geminiApiKey.value() : undefined) ||
            "API_KEY_PLACEHOLDER",
        ...globalConfig
    };

    while (!success && retryCount < maxRetries) {
        try {
            // Load the prompt file
            const creatorProfilePrompt = ai.prompt('creator_profile');

            // Call the prompt with parameters
            const { output } = await creatorProfilePrompt(params, { config });

            if (output) {
                logger.info(`Generated creator profile insights: ${JSON.stringify(output, null, 2)}`);
                success = true;
                logger.info(`Successfully generated creator profile insights`);
                return output;
            }
        } catch (error) {
            logger.error(`Error generating creator profile insights (attempt ${retryCount + 1}): ${error}`);
        }

        retryCount++;

        // Add a small delay between retries
        if (!success && retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    if (!success) {
        logger.error(`Failed to generate creator profile insights after ${maxRetries} attempts. Using existing data.`);
        // Return default values if all retries fail
        return {
            summary: params.existingSummary || "",
            suggestions: params.existingSuggestions || "",
            emotional_overview: params.existingEmotionalOverview || "",
            key_moments: params.existingKeyMoments || "",
            recurring_themes: params.existingRecurringThemes || "",
            progress_and_growth: params.existingProgressAndGrowth || ""
        };
    }

    // This should never be reached due to the return in the success case and the default return above
    throw new Error("Unexpected flow execution path");
}

/**
 * Generate friend profile summaries based on updates
 */
export async function generateFriendProfileFlow(params: {
    existingSummary: string;
    existingSuggestions: string;
    updateContent: string;
    sentiment: string;
    creatorName: string;
}) {
    logger.info(`Generating friend profile insights for update: ${JSON.stringify(params, null, 2)}`);
    // Initialize with existing data as default values
    let success = false;
    let retryCount = 0;
    const maxRetries = 3;

    // Configure with the actual API key at runtime
    const config = {
        apiKey: process.env.GEMINI_API_KEY ||
            (typeof geminiApiKey.value === 'function' ? geminiApiKey.value() : undefined) ||
            "API_KEY_PLACEHOLDER",
        ...globalConfig
    };

    while (!success && retryCount < maxRetries) {
        try {
            // Load the prompt file
            const friendProfilePrompt = ai.prompt('friend_profile');

            // Call the prompt with parameters
            const { output } = await friendProfilePrompt(params, { config });

            if (output) {
                logger.info(`Generated friend profile insights: ${JSON.stringify(output, null, 2)}`);
                success = true;
                logger.info(`Successfully generated friend profile insights`);
                return output;
            }
        } catch (error) {
            logger.error(`Error generating friend profile insights (attempt ${retryCount + 1}): ${error}`);
        }

        retryCount++;

        // Add a small delay between retries
        if (!success && retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    if (!success) {
        logger.error(`Failed to generate friend profile insights after ${maxRetries} attempts. Using existing data.`);
        // Return default values if all retries fail
        return {
            summary: params.existingSummary || "",
            suggestions: params.existingSuggestions || ""
        };
    }

    // This should never be reached due to the return in the success case and the default return above
    throw new Error("Unexpected flow execution path");
}
