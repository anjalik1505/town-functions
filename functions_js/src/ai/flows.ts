import { gemini20FlashLite, googleAI } from '@genkit-ai/googleai';
import { defineSecret } from 'firebase-functions/params';
import { genkit } from 'genkit';
import { z } from 'zod';
import { friendProfileSchema, ownProfileSchema } from '../models/validation-schemas';
import { getLogger } from '../utils/logging-utils';

const logger = getLogger(__filename);

// Define the API key secret for Gemini
export const geminiApiKey = defineSecret("GEMINI_API_KEY");

// Configure a Genkit instance
// For local development, use environment variable
const ai = genkit({
    plugins: [googleAI({
        // Don't access the secret value during initialization
        // It will be accessed at runtime in the flow functions
        apiKey: process.env.GEMINI_API_KEY || "API_KEY_PLACEHOLDER"
    })],
    model: gemini20FlashLite,
});

// Default configuration for AI calls
const globalConfig = {
    maxOutputTokens: 1000,
    temperature: 0.0,
};

// Define the profile insights schema matching our Zod schema
const ProfileInsightsSchema = ownProfileSchema;

// Define the friend profile schema matching our Zod schema
const FriendProfileSchema = friendProfileSchema;

/**
 * Flow for generating creator profile insights based on updates
 */
export const generateCreatorProfileFlow = ai.defineFlow(
    {
        name: 'generateCreatorProfileFlow',
        inputSchema: z.object({
            existingSummary: z.string().optional(),
            existingSuggestions: z.string().optional(),
            existingInsights: z.record(z.string(), z.string()).optional(),
            updateContent: z.string(),
            sentiment: z.string(),
        }),
        outputSchema: ProfileInsightsSchema,
    },
    async ({ existingSummary, existingSuggestions, existingInsights, updateContent, sentiment }) => {
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
                const { output } = await ai.generate({
                    prompt: `You are an AI that analyzes user thoughts shared in updates and generates personalized weekly summaries and recommendations.

### CONTEXT:
- Current Weekly Summary: ${existingSummary || "None"}
- Current Suggestions: ${existingSuggestions || "None"}
- Current Emotional Overview: ${existingInsights?.emotional_overview || "None"}
- Current Key Moments: ${existingInsights?.key_moments || "None"}
- Current Recurring Themes: ${existingInsights?.recurring_themes || "None"}
- Current Progress and Growth: ${existingInsights?.progress_and_growth || "None"}

### NEW UPDATE:
- Content: ${updateContent}
- Sentiment: ${sentiment}

### INSTRUCTIONS:
1. Analyze the new update in context of existing content
2. Update (don't completely overwrite) the weekly summary, suggestions, emotional overview, key moments, recurring themes, and progress and growth
3. Maintain older important content while allowing less relevant older items to gradually fall out
4. Address the user as "You" instead of by name
5. Sort all highlights chronologically
6. Ensure highlights remain specific when details are provided
7. Add appropriate emojis to each highlight based on sentiment
8. Use natural time descriptors:
   - "Today" for today's events
   - "Recently" or "Lately" for older events
9. Avoid vague terms like "something" - maintain clarity
10. For each section:
    - Summary: Provide a concise weekly overview ending with an emoji
    - Suggestions: Offer at least 3 actionable recommendations
    - Emotional Overview: Analyze emotional patterns and trends
    - Key Moments: Highlight significant events or realizations
    - Recurring Themes: Identify patterns across updates
    - Progress and Growth: Note positive developments and growth areas

### RESPONSE FORMAT:
Respond with a JSON object containing these fields:
- summary: string
- suggestions: string
- emotional_overview: string
- key_moments: string
- recurring_themes: string
- progress_and_growth: string

All text should be properly formatted with appropriate line breaks and emojis.`,
                    output: { schema: ProfileInsightsSchema },
                    config,
                });

                if (output) {
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
                summary: existingSummary || "",
                suggestions: existingSuggestions || "",
                emotional_overview: existingInsights?.emotional_overview || "",
                key_moments: existingInsights?.key_moments || "",
                recurring_themes: existingInsights?.recurring_themes || "",
                progress_and_growth: existingInsights?.progress_and_growth || ""
            };
        }

        // This should never be reached due to the return in the success case and the default return above
        throw new Error("Unexpected flow execution path");
    }
);

/**
 * Flow for generating friend profile summaries based on updates
 */
export const generateFriendProfileFlow = ai.defineFlow(
    {
        name: 'generateFriendProfileFlow',
        inputSchema: z.object({
            existingSummary: z.string().optional(),
            existingSuggestions: z.string().optional(),
            updateContent: z.string(),
            sentiment: z.string(),
            creatorName: z.string(),
        }),
        outputSchema: FriendProfileSchema,
    },
    async ({ existingSummary, existingSuggestions, updateContent, sentiment, creatorName }) => {
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
                const { output } = await ai.generate({
                    prompt: `You are an AI that summarizes user thoughts in reported speech format for their friends.

### CONTEXT:
- Current Summary: ${existingSummary || "None"}
- Current Suggestions: ${existingSuggestions || "None"}

### NEW UPDATE:
- Content: ${updateContent}
- Sentiment: ${sentiment}
- Username: ${creatorName}

### INSTRUCTIONS:
1. Analyze the new update in context of existing content
2. Update (don't completely overwrite) the summary and suggestions
3. Maintain older important content while allowing less relevant older items to gradually fall out
4. Summarize the activities of ${creatorName} using their username in third-person (e.g., "${creatorName} said..." or "${creatorName} shared...")
5. Sort the highlights chronologically
6. Ensure highlights remain specific when details are provided
7. Each highlight should end with an appropriate emoji based on sentiment
8. Use natural time descriptors:
   - "Today" for today's events
   - "Recently" or "Lately" for older events
9. Avoid vague terms like "something" - maintain clarity
10. Avoid excessive repetition of the username; use it only where it enhances clarity
11. Where relevant, use the username explicitly, like: "${creatorName} said..." or "Recently, ${creatorName} shared..."
12. For each section:
    - Summary: Provide a concise overview of ${creatorName}'s updates ending with an emoji
    - Suggestions: Offer at least 3 conversation starters or questions to ask ${creatorName}

### RESPONSE FORMAT:
Respond with a JSON object containing these fields:
- summary: string
- suggestions: string

All text should be properly formatted with appropriate line breaks and emojis.`,
                    output: { schema: FriendProfileSchema },
                    config,
                });

                if (output) {
                    success = true;
                    logger.info(`Successfully generated friend profile summary`);
                    return output;
                }
            } catch (error) {
                logger.error(`Error generating friend profile summary (attempt ${retryCount + 1}): ${error}`);
            }

            retryCount++;

            // Add a small delay between retries
            if (!success && retryCount < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        if (!success) {
            logger.error(`Failed to generate friend profile summary after ${maxRetries} attempts. Using existing data.`);
            // Return default values if all retries fail
            return {
                summary: existingSummary || "",
                suggestions: existingSuggestions || ""
            };
        }

        // This should never be reached due to the return in the success case and the default return above
        throw new Error("Unexpected flow execution path");
    }
);
