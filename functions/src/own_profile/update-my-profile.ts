import { Request } from 'express';
import { getFirestore, PartialWithFieldValue, Timestamp } from 'firebase-admin/firestore';
import { ApiResponse, EventName, ProfileEventParams } from '../models/analytics-events.js';
import { Collections } from '../models/constants.js';
import { ProfileResponse, UpdateProfilePayload } from '../models/data-models.js';
import { pf, ProfileDoc } from '../models/firestore/index.js';
import { NotificationSetting, NudgingSettings, Personality, Tone } from '../models/firestore/profile-doc.js';
import { ConflictError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import {
  extractConnectToForAnalytics,
  extractGoalForAnalytics,
  extractNudgingOccurrence,
  formatProfileResponse,
  getProfileDoc,
  getProfileInsights,
} from '../utils/profile-utils.js';
import { updateTimeBucketMembership } from '../utils/timezone-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Updates the authenticated user's profile information.
 *
 * This function:
 * 1. Checks if a profile exists for the authenticated user
 * 2. Updates the profile with the provided data
 * 3. Updates time bucket membership if nudging settings change
 *
 * Note: Denormalized data updates are handled by the profile update trigger.
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Profile data that can include:
 *                - username: Optional updated username
 *                - name: Optional updated display name
 *                - avatar: Optional updated avatar URL
 *                - location: Optional updated location information
 *                - birthday: Optional updated birthday in ISO format
 *                - notification_settings: Optional updated list of notification preferences
 *                - nudging_settings: Optional updated list of nudging preferences
 *                - gender: Optional updated gender information
 *                - goal: Optional updated goal
 *                - connect_to: Optional updated connect_to preferences
 *                - personality: Optional updated personality type
 *                - tone: Optional updated tone preference
 *                - phone_number: Optional updated phone number
 *
 * @returns A ProfileResponse containing the updated profile information
 *
 * @throws 404: Profile not found
 */
export const updateProfile = async (req: Request): Promise<ApiResponse<ProfileResponse>> => {
  const currentUserId = req.userId;
  logger.info(`Starting update_profile operation for user ID: ${currentUserId}`);

  const db = getFirestore();
  const profileData = req.validated_params as UpdateProfilePayload;

  // Get the profile document using the utility function
  const { ref: profileRef, data: currentProfileData } = await getProfileDoc(currentUserId);
  logger.info(`Retrieved current profile data for user ${currentUserId}`);

  // Check if nudging settings have changed
  const nudgingSettingsChanged = profileData.nudging_settings !== undefined;
  const currentTimezone = currentProfileData.timezone;

  // Check if phone number changed
  const phoneChanged =
    profileData.phone_number !== undefined && profileData.phone_number !== currentProfileData.phone_number;

  // If phone number is changing, ensure new phone is not taken
  if (phoneChanged) {
    const existingPhoneDoc = await db
      .collection(Collections.PHONES)
      .doc(profileData.phone_number as string)
      .get();
    if (existingPhoneDoc.exists && existingPhoneDoc.data()?.user_id !== currentUserId) {
      throw new ConflictError('Phone number is already registered by another user');
    }
  }

  // Prepare update data
  const profileUpdates: PartialWithFieldValue<ProfileDoc> = {};

  // Only update fields that are provided in the request
  if (profileData.username !== undefined) {
    profileUpdates[pf('username')] = profileData.username;
  }
  if (profileData.name !== undefined) {
    profileUpdates[pf('name')] = profileData.name;
  }
  if (profileData.avatar !== undefined) {
    profileUpdates[pf('avatar')] = profileData.avatar;
  }
  if (profileData.birthday !== undefined) {
    profileUpdates[pf('birthday')] = profileData.birthday;
  }
  if (profileData.notification_settings !== undefined) {
    profileUpdates[pf('notification_settings')] = profileData.notification_settings as NotificationSetting[];
  }
  if (profileData.nudging_settings !== undefined) {
    profileUpdates[pf('nudging_settings')] = profileData.nudging_settings as NudgingSettings;
  }
  if (profileData.gender !== undefined) {
    profileUpdates[pf('gender')] = profileData.gender;
  }
  if (profileData.goal !== undefined) {
    profileUpdates[pf('goal')] = profileData.goal;
  }
  if (profileData.connect_to !== undefined) {
    profileUpdates[pf('connect_to')] = profileData.connect_to;
  }
  if (profileData.personality !== undefined) {
    profileUpdates[pf('personality')] = profileData.personality as Personality;
  }
  if (profileData.tone !== undefined) {
    profileUpdates[pf('tone')] = profileData.tone as Tone;
  }
  if (profileData.phone_number !== undefined) {
    profileUpdates[pf('phone_number')] = profileData.phone_number;
  }

  // Create a batch for all updates
  const batch = db.batch();

  // Update the profile in the batch
  if (Object.keys(profileUpdates).length > 0) {
    profileUpdates[pf('updated_at')] = Timestamp.now();
    batch.update(profileRef, profileUpdates);
    logger.info(`Added profile update to batch for user ${currentUserId}`);
  }

  // Handle time bucket membership if nudging settings changed and user has timezone
  if (nudgingSettingsChanged && currentTimezone) {
    const newNudgingSettings = profileData.nudging_settings as NudgingSettings;
    await updateTimeBucketMembership(currentUserId, newNudgingSettings, currentTimezone, batch, db);
  }

  // Commit all the updates in a single atomic operation
  if (Object.keys(profileUpdates).length > 0 || nudgingSettingsChanged) {
    await batch.commit();
    logger.info(`Committed batch updates for user ${currentUserId}`);
  }

  // Get the updated profile data
  const updatedProfileDoc = await profileRef.get();
  const updatedProfileData = updatedProfileDoc.data();
  if (!updatedProfileData) {
    throw new Error(`Profile data is undefined for user ${currentUserId}`);
  }

  // Get insights data
  const insightsData = await getProfileInsights(profileRef);

  // Format and return the response
  const response = formatProfileResponse(currentUserId, updatedProfileData, insightsData);

  // Track profile update event
  const event: ProfileEventParams = {
    has_name: !!updatedProfileData.name,
    has_avatar: !!updatedProfileData.avatar,
    has_location: !!updatedProfileData.location,
    has_birthday: !!updatedProfileData.birthday,
    has_notification_settings:
      Array.isArray(updatedProfileData.notification_settings) && updatedProfileData.notification_settings.length > 0,
    nudging_occurrence: extractNudgingOccurrence(updatedProfileData),
    has_gender: !!updatedProfileData.gender,
    goal: extractGoalForAnalytics(updatedProfileData),
    connect_to: extractConnectToForAnalytics(updatedProfileData),
    personality: updatedProfileData.personality || '',
    tone: updatedProfileData.tone || '',
  };

  return {
    data: response,
    status: 200,
    analytics: {
      event: EventName.PROFILE_UPDATED,
      userId: currentUserId,
      params: event,
    },
  };
};
