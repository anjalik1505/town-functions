import { googleAI } from '@genkit-ai/googleai';
import { Request, Response } from 'express';
import { defineSecret } from 'firebase-functions/params';
import { genkit } from 'genkit';
import { getLogger } from '../utils/logging-utils';

const logger = getLogger(__filename);
// Define the API key secret for Gemini
export const geminiApiKey = defineSecret("GEMINI_API_KEY");

// Configure a Genkit instance with the prompts directory
const ai = genkit({
    plugins: [googleAI({
        apiKey: process.env.GEMINI_API_KEY || "API_KEY_PLACEHOLDER"
    })],
});

export const testPrompt = async (req: Request, res: Response) => {
    try {
        const data = req.validated_params;
        const summary = data.summary;
        const suggestions = data.suggestions;
        const existingEmotionalOverview = data.emotional_overview;
        const existingKeyMoments = data.key_moments;
        const existingRecurringThemes = data.recurring_themes;
        const existingProgressAndGrowth = data.progress_and_growth;
        const updateContent = data.update_content;
        const updateSentiment = data.update_sentiment;

        let success = false;
        let retryCount = 0;
        const maxRetries = 3;
        while (!success && retryCount < maxRetries) {
            try {
                const { output } = await ai.generate({
                    prompt: `### CONTEXT:
        - Current Weekly Summary: ${{ summary }}
        - Current Suggestions: ${{ suggestions }}
        - Current Emotional Overview: ${{ existingEmotionalOverview }}
        - Current Key Moments: ${{ existingKeyMoments }}
        - Current Recurring Themes: ${{ existingRecurringThemes }}
        - Current Progress and Growth: ${{ existingProgressAndGrowth }}
        
        ### NEW UPDATE:
        - Content: ${{ updateContent }}
        - Sentiment: ${{ updateSentiment }}
        
        ` + prompt,
                    config: {
                        maxOutputTokens: 1000,
                        temperature: 0.0,
                    },
                });

                if (output) {
                    success = true;
                    return res.json(output);
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

        // Return error if all retries failed
        return res.status(500).json({
            code: 500,
            name: "Internal Server Error",
            description: "Failed to generate response after all retries"
        });
    } catch (error) {
        console.error("Error in test/prompt:", error);
        return res.status(500).json({
            code: 500,
            name: "Internal Server Error",
            description: "Failed to generate response"
        });
    }
} 