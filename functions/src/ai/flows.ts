import { googleAI } from '@genkit-ai/googleai';
import { defineSecret } from 'firebase-functions/params';
import { genkit } from 'genkit';
import { FriendPlaceholderChecks, Placeholders } from '../models/constants.js';
import { getLogger } from '../utils/logging-utils.js';

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

// Define the API key secret for Gemini
export const geminiApiKey = defineSecret('GEMINI_API_KEY');

// Configure a Genkit instance with the prompts directory
const ai = genkit({
  plugins: [
    googleAI({
      // Don't access the secret value during initialization
      // It will be accessed at runtime in the flow functions
      apiKey: process.env.GEMINI_API_KEY,
    }),
  ],
});

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
  logPrefix: string,
): Promise<T> => {
  logger.info(`${logPrefix}: ${JSON.stringify(params, null, 2)}`);

  let success = false;
  let retryCount = 0;
  const maxRetries = 3;

  // Configure with the actual API key at runtime
  const config = {
    apiKey: process.env.GEMINI_API_KEY,
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
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
        params: params,
      });
    }

    retryCount++;

    // Add a small delay between retries
    if (!success && retryCount < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (!success) {
    logger.error(
      `Failed to execute ${logPrefix} after ${maxRetries} attempts. Using default output.`,
    );
    return defaultOutput;
  }

  // This should never be reached due to the return in the success case and the default return above
  throw new Error('Unexpected flow execution path');
};

/**
 * Generate creator profile insights based on updates, handling placeholders.
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
  const originalParams = { ...params };

  const aiParams = { ...params };
  if (aiParams.existingSummary === Placeholders.SUMMARY) {
    aiParams.existingSummary = '';
  }
  if (aiParams.existingSuggestions === Placeholders.SUGGESTIONS) {
    aiParams.existingSuggestions = '';
  }
  if (aiParams.existingEmotionalOverview === Placeholders.EMOTIONAL_OVERVIEW) {
    aiParams.existingEmotionalOverview = '';
  }
  if (aiParams.existingKeyMoments === Placeholders.KEY_MOMENTS) {
    aiParams.existingKeyMoments = '';
  }
  if (aiParams.existingRecurringThemes === Placeholders.RECURRING_THEMES) {
    aiParams.existingRecurringThemes = '';
  }
  if (aiParams.existingProgressAndGrowth === Placeholders.PROGRESS_AND_GROWTH) {
    aiParams.existingProgressAndGrowth = '';
  }

  const defaultOutput = {
    summary: originalParams.existingSummary,
    suggestions: originalParams.existingSuggestions,
    emotional_overview: originalParams.existingEmotionalOverview,
    key_moments: originalParams.existingKeyMoments,
    recurring_themes: originalParams.existingRecurringThemes,
    progress_and_growth: originalParams.existingProgressAndGrowth,
  };

  logger.error(
    `Generating creator profile insights with params: ${JSON.stringify(params, null, 2)}`,
  );

  const aiResult = await executeAIFlow<{
    summary: string;
    suggestions: string;
    emotional_overview: string;
    key_moments: string;
    recurring_themes: string;
    progress_and_growth: string;
  }>(
    'creator_profile',
    aiParams,
    defaultOutput,
    'Generating creator profile insights',
  );

  const finalResult = { ...aiResult };

  const isEmpty = (str: string | null | undefined) =>
    !str || str.trim().length === 0;

  if (isEmpty(finalResult.summary)) {
    finalResult.summary = originalParams.existingSummary;
  }
  if (isEmpty(finalResult.suggestions)) {
    finalResult.suggestions = originalParams.existingSuggestions;
  }
  if (isEmpty(finalResult.emotional_overview)) {
    finalResult.emotional_overview = originalParams.existingEmotionalOverview;
  }
  if (isEmpty(finalResult.key_moments)) {
    finalResult.key_moments = originalParams.existingKeyMoments;
  }
  if (isEmpty(finalResult.recurring_themes)) {
    finalResult.recurring_themes = originalParams.existingRecurringThemes;
  }
  if (isEmpty(finalResult.progress_and_growth)) {
    finalResult.progress_and_growth = originalParams.existingProgressAndGrowth;
  }

  logger.info(
    `Post-processed creator profile insights: ${JSON.stringify(finalResult, null, 2)}`,
  );

  return finalResult;
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
  const originalParams = { ...params };

  const aiParams = { ...params };

  if (aiParams.existingSummary?.includes(FriendPlaceholderChecks.SUMMARY_END)) {
    aiParams.existingSummary = '';
  }
  if (
    aiParams.existingSuggestions?.includes(
      FriendPlaceholderChecks.SUGGESTIONS_END,
    )
  ) {
    aiParams.existingSuggestions = '';
  }

  const defaultOutput = {
    summary: originalParams.existingSummary,
    suggestions: originalParams.existingSuggestions,
  };

  logger.error(
    `Generating friend profile insights with params: ${JSON.stringify(params, null, 2)}`,
  );

  const aiResult = await executeAIFlow<{
    summary: string;
    suggestions: string;
  }>(
    'friend_profile',
    aiParams,
    defaultOutput,
    'Generating friend profile insights',
  );

  const finalResult = { ...aiResult };

  const isEmpty = (str: string | null | undefined) =>
    !str || str.trim().length === 0;

  if (isEmpty(finalResult.summary)) {
    finalResult.summary = originalParams.existingSummary;
  }
  if (isEmpty(finalResult.suggestions)) {
    finalResult.suggestions = originalParams.existingSuggestions;
  }

  logger.info(
    `Post-processed friend profile insights: ${JSON.stringify(finalResult, null, 2)}`,
  );

  return finalResult;
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
  const aiParams = { ...params };
  if (aiParams.existingSummary === Placeholders.SUMMARY) {
    aiParams.existingSummary = '';
  }
  if (aiParams.existingSuggestions === Placeholders.SUGGESTIONS) {
    aiParams.existingSuggestions = '';
  }
  if (aiParams.existingEmotionalOverview === Placeholders.EMOTIONAL_OVERVIEW) {
    aiParams.existingEmotionalOverview = '';
  }
  if (aiParams.existingKeyMoments === Placeholders.KEY_MOMENTS) {
    aiParams.existingKeyMoments = '';
  }
  if (aiParams.existingRecurringThemes === Placeholders.RECURRING_THEMES) {
    aiParams.existingRecurringThemes = '';
  }
  if (aiParams.existingProgressAndGrowth === Placeholders.PROGRESS_AND_GROWTH) {
    aiParams.existingProgressAndGrowth = '';
  }

  const defaultOutput = {
    question: "How's your day going? Share with your Village!",
  };

  logger.error(
    `Generating question with params: ${JSON.stringify(params, null, 2)}`,
  );

  // Short-circuit if user has no existing summary
  if (!aiParams.existingSummary.trim()) {
    return defaultOutput;
  }

  return executeAIFlow(
    'generate_question',
    aiParams,
    defaultOutput,
    'Generating personalized question',
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
    message: `${params.friendName} shared an update with you.`,
  };

  logger.error(
    `Generating notification message with params: ${JSON.stringify(params, null, 2)}`,
  );

  return executeAIFlow(
    'notification_message',
    params,
    defaultOutput,
    'Generating notification message',
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
    is_urgent: false,
  };

  logger.error(
    `Determining urgency with params: ${JSON.stringify(params, null, 2)}`,
  );

  return executeAIFlow(
    'determine_urgency',
    params,
    defaultOutput,
    'Determining update urgency',
  );
};

/**
 * Analyze sentiment, score, and generate an emoji for text input
 */
export const analyzeSentimentFlow = async (params: { content: string }) => {
  const defaultOutput = {
    sentiment: 'unknown',
    score: 3,
    emoji: '😐',
  };

  logger.error(
    `Analyzing sentiment with params: ${JSON.stringify(params, null, 2)}`,
  );

  return executeAIFlow(
    'analyze_sentiment',
    params,
    defaultOutput,
    'Analyzing text sentiment',
  );
};

/**
 * Generate a daily notification message for a user
 */
export const generateDailyNotificationFlow = async (params: {
  name: string;
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
    title: 'Daily Check-in',
    message: `Hey ${params.name}, how are you doing today?`,
  };

  logger.error(
    `Generating daily notification message with params: ${JSON.stringify(params, null, 2)}`,
  );

  return executeAIFlow(
    'daily_notification',
    params,
    defaultOutput,
    'Generating daily notification message',
  );
};

/**
 * Transcribes audio.
 */
export const transcribeAudioFlow = async (params: {
  audioData: string;
  mimeType: string;
}) => {
  const defaultOutput = {
    transcription: `I'm sorry, I couldn't transcribe that audio.`,
    sentiment: 'neutral',
    score: 3,
    emoji: '😐',
  };

  logger.error(`Generating transcription with mime type ${params.mimeType}`);

  return executeAIFlow(
    'transcribe_audio',
    params,
    defaultOutput,
    'Generating transcription and sentiment',
  );
};
