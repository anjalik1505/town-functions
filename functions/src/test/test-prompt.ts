import { gemini20FlashLite, googleAI } from '@genkit-ai/googleai';
import { Request, Response } from 'express';
import { genkit } from 'genkit';
import {
  friendProfileSchema,
  ownProfileSchema,
} from '../models/validation-schemas';
import { InternalServerError } from '../utils/errors';
import { getLogger } from '../utils/logging-utils';

const logger = getLogger(__filename);

// Configure a Genkit instance
const ai = genkit({
  plugins: [
    googleAI({
      apiKey: process.env.GEMINI_API_KEY,
    }),
  ],
  model: gemini20FlashLite,
});

export const testPrompt = async (
  req: Request,
  res: Response,
): Promise<void> => {
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
    const gender = data.gender;
    const location = data.location;

    let success = false;
    let retryCount = 0;
    const maxRetries = 3;

    while (!success && retryCount < maxRetries) {
      try {
        const config = {
          apiKey: process.env.GEMINI_API_KEY,
          maxOutputTokens: 1000,
          temperature: data.temperature ?? 0.0,
        };

        const { output } = await ai.generate({
          prompt: `### CONTEXT:
                    - <SUMMARY>: ${summary}
                    - <SUGGESTIONS>: ${suggestions}${
                      data.is_own_profile
                        ? `
                    - <EMOTIONAL_OVERVIEW>: ${existingEmotionalOverview}
                    - <KEY_MOMENTS>: ${existingKeyMoments}
                    - <RECURRING_THEMES>: ${existingRecurringThemes}
                    - <PROGRESS_AND_GROWTH>: ${existingProgressAndGrowth}`
                        : ''
                    }
                    - <GENDER>: ${gender}
                    - <LOCATION>: ${location}
                    
                    ### NEW UPDATE:
                    - <UPDATE>: ${updateContent}
                    - <SENTIMENT>: ${updateSentiment}
                    
                    ${data.prompt}`,
          output: {
            schema: data.is_own_profile
              ? ownProfileSchema
              : friendProfileSchema,
          },
          config,
        });

        if (output) {
          success = true;
          logger.info('Generated output:', JSON.stringify(output, null, 2));
          res.json(output);
        }
      } catch (error) {
        logger.error(
          `Error generating creator profile insights (attempt ${retryCount + 1}): ${error}`,
        );
      }

      retryCount++;

      // Add a small delay between retries
      if (!success && retryCount < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // Return error if all retries failed
    throw new InternalServerError(
      'Failed to generate response after all retries',
    );
  } catch (error) {
    logger.error('Error in test/prompt:', error);
    throw new InternalServerError('Failed to generate response');
  }
};
