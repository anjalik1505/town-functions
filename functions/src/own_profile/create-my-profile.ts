import { Request } from 'express';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  ApiResponse,
  EventName,
  ProfileEventParams,
} from '../models/analytics-events.js';
import {
  Collections,
  Documents,
  InsightsFields,
  Placeholders,
  ProfileFields,
} from '../models/constants.js';
import { Insights, ProfileResponse } from '../models/data-models.js';
import { getLogger } from '../utils/logging-utils.js';
import {
  formatProfileResponse,
  getProfileInsights,
  profileExists,
} from '../utils/profile-utils.js';

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

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
 *                - gender: Optional gender information
 *
 * @returns A ProfileResponse containing:
 * - Basic profile information (id, username, name, avatar)
 * - Optional profile fields (location, birthday, notification_settings, gender)
 * - Empty insights, summary, suggestions information
 *
 * @throws 400: Profile already exists for user {user_id}
 */
export const createProfile = async (
  req: Request,
): Promise<ApiResponse<ProfileResponse>> => {
  const currentUserId = req.userId;
  logger.info(`Starting add_user operation for user ID: ${currentUserId}`);

  const db = getFirestore();
  const profileData = req.validated_params;

  // Check if profile already exists using the utility function
  await profileExists(currentUserId);

  logger.info(`Creating new profile for user ${currentUserId}`);

  const updatedAt = Timestamp.now();

  // Create profile with provided data
  const profileDataToSave = {
    [ProfileFields.USERNAME]: profileData.username,
    [ProfileFields.NAME]: profileData.name || '',
    [ProfileFields.AVATAR]: profileData.avatar || '',
    [ProfileFields.LOCATION]: profileData.location || '',
    [ProfileFields.BIRTHDAY]: profileData.birthday || '',
    [ProfileFields.NOTIFICATION_SETTINGS]:
      profileData.notification_settings || [],
    [ProfileFields.GENDER]: profileData.gender || '',
    [ProfileFields.SUMMARY]: Placeholders.SUMMARY,
    [ProfileFields.SUGGESTIONS]: Placeholders.SUGGESTIONS,
    [ProfileFields.GROUP_IDS]: [],
    [ProfileFields.UPDATED_AT]: updatedAt,
    [ProfileFields.CREATED_AT]: updatedAt,
  };

  // Create the profile document
  const profileRef = db.collection(Collections.PROFILES).doc(currentUserId);
  await profileRef.set(profileDataToSave);
  logger.info(`Profile document created for user ${currentUserId}`);

  // Create an empty insights subcollection document with placeholders
  const insightsRef = profileRef
    .collection(Collections.INSIGHTS)
    .doc(Documents.DEFAULT_INSIGHTS);
  const insightsData: Insights = {
    [InsightsFields.EMOTIONAL_OVERVIEW]: Placeholders.EMOTIONAL_OVERVIEW,
    [InsightsFields.KEY_MOMENTS]: Placeholders.KEY_MOMENTS,
    [InsightsFields.RECURRING_THEMES]: Placeholders.RECURRING_THEMES,
    [InsightsFields.PROGRESS_AND_GROWTH]: Placeholders.PROGRESS_AND_GROWTH,
  };
  await insightsRef.set(insightsData);
  logger.info(`Insights document created for user ${currentUserId}`);

  // Get the insights data using the utility function
  const insights = await getProfileInsights(profileRef);

  // Format and return the response using the utility function
  const response = formatProfileResponse(
    currentUserId,
    profileDataToSave,
    insights,
  );

  logger.info(
    `User profile creation completed successfully for user ${currentUserId}`,
  );

  // Track profile creation event
  const event: ProfileEventParams = {
    has_name: !!profileData.name,
    has_avatar: !!profileData.avatar,
    has_location: !!profileData.location,
    has_birthday: !!profileData.birthday,
    has_notification_settings:
      Array.isArray(profileData.notification_settings) &&
      profileData.notification_settings.length > 0,
    has_gender: !!profileData.gender,
  };

  return {
    data: response,
    status: 201,
    analytics: {
      event: EventName.PROFILE_CREATED,
      userId: currentUserId,
      params: event,
    },
  };
};
