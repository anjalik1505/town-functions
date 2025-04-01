import { Request, Response } from "express";
import { getFirestore } from "firebase-admin/firestore";
import { Collections, InsightsFields, ProfileFields } from "../models/constants";
import { ProfileResponse } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { formatTimestamp } from "../utils/timestamp-utils";

const logger = getLogger(__filename);

/**
 * Retrieves the current user's profile with insights information.
 * 
 * This function:
 * 1. Fetches the authenticated user's profile data from Firestore
 * 2. Retrieves any available insights data
 * 3. Combines the data into a comprehensive profile response
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 * @param res - The Express response object
 * 
 * @returns A ProfileResponse containing:
 * - Basic profile information (id, username, name, avatar)
 * - Optional profile fields (location, birthday, notification_settings, summary, suggestions)
 * - Insights information (emotional overview, key moments, themes, growth)
 * 
 * @throws 404: Profile not found
 */
export const getProfile = async (req: Request, res: Response): Promise<void> => {
  const currentUserId = req.userId;
  logger.info(`Retrieving profile for user: ${currentUserId}`);

  const db = getFirestore();

  // Get the user's profile document
  const profileRef = db.collection(Collections.PROFILES).doc(currentUserId);
  const profileDoc = await profileRef.get();

  // Check if the profile exists
  if (!profileDoc.exists) {
    logger.warn(`Profile not found for user: ${currentUserId}`);
    res.status(404).json({
      code: 404,
      name: "Not Found",
      description: "Profile not found"
    });
  }

  // Extract profile data
  const profileData = profileDoc.data() || {};
  logger.info(`Retrieved profile data for user: ${currentUserId}`);

  // Get insights data - using collection().limit(1) instead of direct document reference
  // as we're not sure which document to use
  const insightsSnapshot = await profileRef.collection(Collections.INSIGHTS).limit(1).get();
  const insightsDoc = insightsSnapshot.docs[0];
  const insightsData = insightsDoc?.data() || {};
  logger.info(`Retrieved insights data for user: ${currentUserId}`);

  // Format updated_at timestamp if it exists
  const updatedAt = profileData[ProfileFields.UPDATED_AT] ? formatTimestamp(profileData[ProfileFields.UPDATED_AT]) : "";

  // Construct and return the profile response
  const response: ProfileResponse = {
    user_id: currentUserId,
    username: profileData[ProfileFields.USERNAME] || "",
    name: profileData[ProfileFields.NAME] || "",
    avatar: profileData[ProfileFields.AVATAR] || "",
    location: profileData[ProfileFields.LOCATION] || "",
    birthday: profileData[ProfileFields.BIRTHDAY] || "",
    notification_settings: profileData[ProfileFields.NOTIFICATION_SETTINGS] || [],
    gender: profileData[ProfileFields.GENDER] || "",
    summary: profileData[ProfileFields.SUMMARY] || "",
    suggestions: profileData[ProfileFields.SUGGESTIONS] || "",
    updated_at: updatedAt,
    insights: {
      emotional_overview: insightsData[InsightsFields.EMOTIONAL_OVERVIEW] || "",
      key_moments: insightsData[InsightsFields.KEY_MOMENTS] || "",
      recurring_themes: insightsData[InsightsFields.RECURRING_THEMES] || "",
      progress_and_growth: insightsData[InsightsFields.PROGRESS_AND_GROWTH] || ""
    }
  };

  res.json(response);
}; 