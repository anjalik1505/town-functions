import { Request, Response } from "express";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Collections, Documents, InsightsFields, ProfileFields } from "../models/constants";
import { Insights, ProfileResponse } from "../models/data-models";
import { getLogger } from "../utils/logging_utils";
import { formatTimestamp } from "../utils/timestamp_utils";

const logger = getLogger(__filename);

/**
 * Creates a new profile for the authenticated user.
 * 
 * This function:
 * 1. Checks if a profile already exists for the authenticated user
 * 2. If not, creates a new profile with the provided data
 * 3. Initializes related collections like insights
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Profile data including:
 *                - username: Mandatory username for the user
 *                - name: Optional display name
 *                - avatar: Optional avatar URL
 *                - location: Optional location information
 *                - birthday: Optional birthday in ISO format
 *                - notification_settings: Optional list of notification preferences
 * @param res - The Express response object
 * 
 * @returns A ProfileResponse containing:
 * - Basic profile information (id, username, name, avatar)
 * - Optional profile fields (location, birthday, notification_settings)
 * - Empty insights, summary, suggestions information
 * 
 * @throws 400: Profile already exists for user {user_id}
 */
export const createProfile = async (req: Request, res: Response) => {
  const currentUserId = req.userId;
  logger.info(`Starting add_user operation for user ID: ${currentUserId}`);

  const db = getFirestore();
  const profileData = req.validated_params;

  // Check if profile already exists
  const profileRef = db.collection(Collections.PROFILES).doc(currentUserId);
  const profileDoc = await profileRef.get();

  if (profileDoc.exists) {
    logger.warn(`Profile already exists for user ${currentUserId}`);
    return res.status(400).json({
      code: 400,
      name: "Bad Request",
      description: `Profile already exists for user ${currentUserId}`
    });
  }

  logger.info(`Creating new profile for user ${currentUserId}`);

  const updatedAt = Timestamp.now();

  // Create profile with provided data
  const profileDataToSave = {
    [ProfileFields.USERNAME]: profileData.username,
    [ProfileFields.NAME]: profileData.name || "",
    [ProfileFields.AVATAR]: profileData.avatar || "",
    [ProfileFields.LOCATION]: profileData.location || "",
    [ProfileFields.BIRTHDAY]: profileData.birthday || "",
    [ProfileFields.NOTIFICATION_SETTINGS]: profileData.notification_settings || [],
    [ProfileFields.SUMMARY]: "",
    [ProfileFields.SUGGESTIONS]: "",
    [ProfileFields.GROUP_IDS]: [],
    [ProfileFields.UPDATED_AT]: updatedAt,
  };

  // Create the profile document
  await profileRef.set(profileDataToSave);
  logger.info(`Profile document created for user ${currentUserId}`);

  // Create an empty insights subcollection document
  const insightsRef = profileRef.collection(Collections.INSIGHTS).doc(Documents.DEFAULT_INSIGHTS);
  const insightsData: Insights = {
    [InsightsFields.EMOTIONAL_OVERVIEW]: "",
    [InsightsFields.KEY_MOMENTS]: "",
    [InsightsFields.RECURRING_THEMES]: "",
    [InsightsFields.PROGRESS_AND_GROWTH]: ""
  };
  await insightsRef.set(insightsData);
  logger.info(`Insights document created for user ${currentUserId}`);

  // Create and return a properly typed response
  const response: ProfileResponse = {
    user_id: currentUserId,
    username: profileDataToSave[ProfileFields.USERNAME],
    name: profileDataToSave[ProfileFields.NAME],
    avatar: profileDataToSave[ProfileFields.AVATAR],
    location: profileDataToSave[ProfileFields.LOCATION],
    birthday: profileDataToSave[ProfileFields.BIRTHDAY],
    notification_settings: profileDataToSave[ProfileFields.NOTIFICATION_SETTINGS],
    summary: profileDataToSave[ProfileFields.SUMMARY],
    suggestions: profileDataToSave[ProfileFields.SUGGESTIONS],
    updated_at: formatTimestamp(updatedAt),
    insights: insightsData
  };

  logger.info(`User profile creation completed successfully for user ${currentUserId}`);
  return res.status(201).json(response);
}; 