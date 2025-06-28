import { Request } from 'express';
import { ApiResponse, EventName, ProfileEventParams } from '../models/analytics-events.js';
import { ProfileResponse } from '../models/data-models.js';
import { getLogger } from '../utils/logging-utils.js';
import {
  extractConnectToForAnalytics,
  extractGoalForAnalytics,
  extractNudgingOccurrence,
  formatProfileResponse,
  getProfileDoc,
  getProfileInsights,
} from '../utils/profile-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Retrieves the current user's profile with insight information.
 *
 * This function:
 * 1. Fetches the authenticated user's profile data from Firestore
 * 2. Retrieves any available insights data
 * 3. Combines the data into a comprehensive profile response
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *
 * @returns A ProfileResponse containing:
 * - Basic profile information (id, username, name, avatar)
 * - Optional profile fields (location, birthday, notification_settings, summary, suggestions)
 * - Insights information (emotional overview, key moments, themes, growth)
 *
 * @throws 404: Profile not found
 */
export const getProfile = async (req: Request): Promise<ApiResponse<ProfileResponse>> => {
  const currentUserId = req.userId;
  logger.info(`Retrieving profile for user: ${currentUserId}`);

  // Get the profile document using the utility function
  const { ref: profileRef, data: profileData } = await getProfileDoc(currentUserId);

  // Get insights data
  const insightsData = await getProfileInsights(profileRef);

  // Format and return the response
  const response = formatProfileResponse(currentUserId, profileData, insightsData);

  // Track profile view event
  const event: ProfileEventParams = {
    has_name: !!profileData.name,
    has_avatar: !!profileData.avatar,
    has_location: !!profileData.location,
    has_birthday: !!profileData.birthday,
    has_notification_settings:
      Array.isArray(profileData.notification_settings) && profileData.notification_settings.length > 0,
    nudging_occurrence: extractNudgingOccurrence(profileData),
    has_gender: !!profileData.gender,
    goal: extractGoalForAnalytics(profileData),
    connect_to: extractConnectToForAnalytics(profileData),
    personality: profileData.personality || '',
    tone: profileData.tone || '',
  };

  return {
    data: response,
    status: 200,
    analytics: {
      event: EventName.PROFILE_VIEWED,
      userId: currentUserId,
      params: event,
    },
  };
};
