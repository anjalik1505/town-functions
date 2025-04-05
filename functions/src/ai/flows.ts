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
        apiKey: process.env.GEMINI_API_KEY
    })],
});

// Default configuration for AI calls
const globalConfig = {
    maxOutputTokens: 1000,
    temperature: 0.0,
};

/**
 * Generic function to execute an AI flow with retry logic
 * 
 * @param promptName - The name of the prompt to load
 * @param params - The parameters to pass to the prompt
 * @param defaultOutput - The default output to return if all retries fail
 * @param logPrefix - Prefix for log messages
 * @returns The output from the AI flow
 */
const executeAIFlow = async <T>(
    promptName: string,
    params: Record<string, any>,
    defaultOutput: T,
    logPrefix: string
): Promise<T> => {
    logger.info(`${logPrefix}: ${JSON.stringify(params, null, 2)}`);

    let success = false;
    let retryCount = 0;
    const maxRetries = 3;

    // Configure with the actual API key at runtime
    const config = {
        apiKey: process.env.GEMINI_API_KEY,
        ...globalConfig
    };

    while (!success && retryCount < maxRetries) {
        try {
            // Load the prompt file
            const prompt = ai.prompt(promptName);

            // Call the prompt with parameters
            const { output } = await prompt(params, { config });

            if (output) {
                logger.info(`${logPrefix} result: ${JSON.stringify(output, null, 2)}`);
                success = true;
                logger.info(`Successfully executed ${logPrefix}`);
                return output as T;
            }
        } catch (error) {
            logger.error(`Error in ${logPrefix} (attempt ${retryCount + 1}):`, {
                error: error instanceof Error ? {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                } : error,
                params: params
            });
        }

        retryCount++;

        // Add a small delay between retries
        if (!success && retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    if (!success) {
        logger.error(`Failed to execute ${logPrefix} after ${maxRetries} attempts. Using default output.`);
        return defaultOutput;
    }

    // This should never be reached due to the return in the success case and the default return above
    throw new Error("Unexpected flow execution path");
};

/**
 * Generate creator profile insights based on updates
 */
export const generateCreatorProfileFlow = async (params: {
    existingSummary: string;
    existingSuggestions: string;
    existingEmotionalOverview: string;
    existingKeyMoments: string;
    existingRecurringThemes: string;
    existingProgressAndGrowth: string;
    updateContent: string;
    sentiment: string;
    gender: string;
    location: string;
    age: string;
}) => {
    const defaultOutput = {
        summary: params.existingSummary || "",
        suggestions: params.existingSuggestions || "",
        emotional_overview: params.existingEmotionalOverview || "",
        key_moments: params.existingKeyMoments || "",
        recurring_themes: params.existingRecurringThemes || "",
        progress_and_growth: params.existingProgressAndGrowth || "",
        age: params.age || ""
    };

    return executeAIFlow(
        'creator_profile',
        params,
        defaultOutput,
        'Generating creator profile insights'
    );
};

/**
 * Generate friend profile summaries based on updates
 */
export const generateFriendProfileFlow = async (params: {
    existingSummary: string;
    existingSuggestions: string;
    updateContent: string;
    sentiment: string;
    friendName: string;
    friendGender: string;
    friendLocation: string;
    friendAge: string;
    userName: string;
    userGender: string;
    userLocation: string;
    userAge: string;
}) => {
    const defaultOutput = {
        summary: params.existingSummary || "",
        suggestions: params.existingSuggestions || ""
    };

    return executeAIFlow(
        'friend_profile',
        params,
        defaultOutput,
        'Generating friend profile insights'
    );
};

/**
 * Generate a personalized question to encourage user sharing
 */
export const generateQuestionFlow = async (params: {
    existingSummary: string;
    existingSuggestions: string;
    existingEmotionalOverview: string;
    existingKeyMoments: string;
    existingRecurringThemes: string;
    existingProgressAndGrowth: string;
    gender: string;
    location: string;
    age: string;
}) => {
    const defaultOutput = {
        question: "What's on your mind today?"
    };

    return executeAIFlow(
        'generate_question',
        params,
        defaultOutput,
        'Generating personalized question'
    );
};

/**
 * Generate a notification message for a user based on an update
 */
export const generateNotificationMessageFlow = async (params: {
    updateContent: string;
    sentiment: string;
    score: string;
    friendName: string;
    friendGender: string;
    friendLocation: string;
    friendAge: string;
}) => {
    const defaultOutput = {
        message: `${params.friendName} shared an update with you.`
    };

    return executeAIFlow(
        'notification_message',
        params,
        defaultOutput,
        'Generating notification message'
    );
};

/**
 * Determine if an update is urgent based on its content and sentiment
 */
export const determineUrgencyFlow = async (params: {
    updateContent: string;
    sentiment: string;
    creatorName: string;
    creatorGender: string;
    creatorLocation: string;
}) => {
    const defaultOutput = {
        is_urgent: false
    };

    return executeAIFlow(
        'determine_urgency',
        params,
        defaultOutput,
        'Determining update urgency'
    );
};
