import { Request } from "express";
import { generateQuestionFlow } from "../ai/flows";
import { ApiResponse, EventName, QuestionEventParams } from "../models/analytics-events";
import { Collections, InsightsFields, ProfileFields } from "../models/constants";
import { QuestionResponse } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { calculateAge, getProfileDoc } from "../utils/profile-utils";

const logger = getLogger(__filename);

/**
 * Generates a personalized question to encourage the user to share an update.
 *
 * This function:
 * 1. Fetches the authenticated user's profile data from Firestore
 * 2. Retrieves any available insights data
 * 3. Uses AI to generate a personalized question based on the user's history
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *
 * @returns An ApiResponse containing the question and analytics
 *
 * @throws 404: Profile not found
 * @throws 500: Error generating question or accessing data
 */
export const getQuestion = async (req: Request): Promise<ApiResponse<QuestionResponse>> => {
  const currentUserId = req.userId;
  logger.info(`Generating personalized question for user: ${currentUserId}`);

  // Get the profile document
  const {ref: profileRef, data: profileData} = await getProfileDoc(currentUserId);

  // Extract data from the profile
  const existingSummary = profileData[ProfileFields.SUMMARY];
  const existingSuggestions = profileData[ProfileFields.SUGGESTIONS];
  logger.info(`Retrieved profile data for user: ${currentUserId}`);

  // Get insights data from the profile's insights subcollection
  const insightsSnapshot = await profileRef.collection(Collections.INSIGHTS).limit(1).get();
  const insightsDoc = insightsSnapshot.docs[0];
  const existingInsights = insightsDoc?.data() || {};
  logger.info(`Retrieved insights data for user: ${currentUserId}`);

  // Generate the personalized question
  logger.info(`Generating AI question for user: ${currentUserId}`);
  const result = await generateQuestionFlow({
    existingSummary: existingSummary || "",
    existingSuggestions: existingSuggestions || "",
    existingEmotionalOverview: existingInsights[InsightsFields.EMOTIONAL_OVERVIEW] || "",
    existingKeyMoments: existingInsights[InsightsFields.KEY_MOMENTS] || "",
    existingRecurringThemes: existingInsights[InsightsFields.RECURRING_THEMES] || "",
    existingProgressAndGrowth: existingInsights[InsightsFields.PROGRESS_AND_GROWTH] || "",
    gender: profileData[ProfileFields.GENDER] || "unknown",
    location: profileData[ProfileFields.LOCATION] || "unknown",
    age: calculateAge(profileData[ProfileFields.BIRTHDAY] || "")
  });
  logger.info(`Generated question for user: ${currentUserId}`);

  const response: QuestionResponse = {
    question: result.question
  };

  // Create analytics event
  const event: QuestionEventParams = {
    question_length: result.question.length
  };

  return {
    data: response,
    status: 200,
    analytics: {
      event: EventName.QUESTION_GENERATED,
      userId: currentUserId,
      params: event
    }
  };
}; 