import { gemini20FlashLite, googleAI } from '@genkit-ai/googleai';
import { Request, Response } from 'express';
import { genkit, z } from 'genkit';
import { getLogger } from '../utils/logging-utils';

const logger = getLogger(__filename);

// Configure a Genkit instance
const ai = genkit({
    plugins: [googleAI({
        apiKey: process.env.GEMINI_API_KEY
    })],
    model: gemini20FlashLite,
});

export const ownProfileSchema = z.object({
    summary: z.string(),
    suggestions: z.string(),
    emotional_overview: z.string(),
    key_moments: z.string(),
    recurring_themes: z.string(),
    progress_and_growth: z.string()
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

                const config = {
                    apiKey: process.env.GEMINI_API_KEY,
                    maxOutputTokens: 1000,
                    temperature: 0.0,
                };

                const { output } = await ai.generate({
                    prompt: `### CONTEXT:
                    - Current Weekly Summary: ${summary}
                    - Current Suggestions: ${suggestions}
                    - Current Emotional Overview: ${existingEmotionalOverview}
                    - Current Key Moments: ${existingKeyMoments}
                    - Current Recurring Themes: ${existingRecurringThemes}
                    - Current Progress and Growth: ${existingProgressAndGrowth}
                    
                    ### NEW UPDATE:
                    - Content: ${updateContent}
                    - Sentiment: ${updateSentiment}
                    
                    ${data.prompt}`,
                    output: { schema: ownProfileSchema },
                    config,
                });

                if (output) {
                    success = true;
                    logger.info("Generated output:", JSON.stringify(output, null, 2));
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