import { Request } from 'express';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { ApiResponse, EventName, ProfileEventParams } from '../models/analytics-events.js';
import { Collections, Documents, Placeholders } from '../models/constants.js';
import { CreateProfilePayload, ProfileResponse } from '../models/data-models.js';
import { InsightsDoc, ProfileDoc, insightsConverter, profileConverter } from '../models/firestore/index.js';
import {
  ConnectTo,
  Goals,
  NotificationSetting,
  NudgingOccurrence,
  NudgingSettings,
  Personalities,
  Personality,
  Tone,
  Tones,
} from '../models/firestore/profile-doc.js';
import { ConflictError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import {
  extractConnectToForAnalytics,
  extractGoalForAnalytics,
  extractNudgingOccurrence,
  formatProfileResponse,
  getProfileInsights,
  profileExists,
} from '../utils/profile-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

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
 *              - validated_params: Profile data including
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
export const createProfile = async (req: Request): Promise<ApiResponse<ProfileResponse>> => {
  const currentUserId = req.userId;
  logger.info(`Starting add_user operation for user ID: ${currentUserId}`);

  const db = getFirestore();
  const profileData = req.validated_params as CreateProfilePayload;

  // Check if a profile already exists using the utility function
  await profileExists(currentUserId);

  logger.info(`Creating new profile for user ${currentUserId}`);

  const updatedAt = Timestamp.now();

  // Extract phone number (optional)
  const phoneNumber = profileData.phone_number;

  // If phone provided ensure uniqueness and prepare mapping
  let phoneRef: FirebaseFirestore.DocumentReference | null = null;
  if (phoneNumber) {
    phoneRef = db.collection(Collections.PHONES).doc(phoneNumber);
    const phoneDoc = await phoneRef.get();
    if (phoneDoc.exists) {
      throw new ConflictError(`Phone number ${phoneNumber} is already registered`);
    }
  }

  // Create a profile with provided data
  const profileDataToSave: ProfileDoc = {
    user_id: currentUserId,
    username: profileData.username,
    name: profileData.name || '',
    avatar: profileData.avatar || '',
    location: '',
    birthday: profileData.birthday || '',
    notification_settings: (profileData.notification_settings || []) as NotificationSetting[],
    nudging_settings: (profileData.nudging_settings as NudgingSettings) || {
      occurrence: NudgingOccurrence.NEVER,
    },
    gender: profileData.gender || '',
    timezone: '',
    goal: profileData.goal || Goals.EMPTY,
    connect_to: profileData.connect_to || ConnectTo.EMPTY,
    personality: (profileData.personality as Personality) || Personalities.EMPTY,
    tone: (profileData.tone as Tone) || Tones.SURPRISE_ME,
    summary: Placeholders.SUMMARY,
    suggestions: Placeholders.SUGGESTIONS,
    group_ids: [],
    updated_at: updatedAt,
    created_at: updatedAt,
    phone_number: phoneNumber || '',
    friend_count: 0,
  };

  // Create the profile document
  const profileRef = db.collection(Collections.PROFILES).withConverter(profileConverter).doc(currentUserId);
  await profileRef.set(profileDataToSave);
  logger.info(`Profile document created for user ${currentUserId}`);

  // Create phones mapping document if phone provided
  if (phoneNumber && phoneRef) {
    await phoneRef.set({
      user_id: currentUserId,
      username: profileData.username,
      name: profileData.name || '',
      avatar: profileData.avatar || '',
    });

    logger.info(`Phone mapping created for ${phoneNumber}`);
  }

  // Create an empty insight subcollection document with placeholders
  const insightsRef = profileRef
    .collection(Collections.INSIGHTS)
    .withConverter(insightsConverter)
    .doc(Documents.DEFAULT_INSIGHTS);
  const insightsData: InsightsDoc = {
    emotional_overview: Placeholders.EMOTIONAL_OVERVIEW,
    key_moments: Placeholders.KEY_MOMENTS,
    recurring_themes: Placeholders.RECURRING_THEMES,
    progress_and_growth: Placeholders.PROGRESS_AND_GROWTH,
  };
  await insightsRef.set(insightsData);
  logger.info(`Insights document created for user ${currentUserId}`);

  // Get the insight data using the utility function
  const insights = await getProfileInsights(profileRef);

  // Format and return the response using the utility function
  const response = formatProfileResponse(currentUserId, profileDataToSave, insights);

  logger.info(`User profile creation completed successfully for user ${currentUserId}`);

  // Track profile creation event
  const event: ProfileEventParams = {
    has_name: !!profileData.name,
    has_avatar: !!profileData.avatar,
    has_location: false,
    has_birthday: !!profileData.birthday,
    has_notification_settings:
      Array.isArray(profileData.notification_settings) && profileData.notification_settings.length > 0,
    nudging_occurrence: extractNudgingOccurrence(profileDataToSave),
    has_gender: !!profileData.gender,
    goal: extractGoalForAnalytics(profileDataToSave),
    connect_to: extractConnectToForAnalytics(profileDataToSave),
    personality: profileData.personality || '',
    tone: profileData.tone || '',
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
