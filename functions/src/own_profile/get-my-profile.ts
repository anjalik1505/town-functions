import { Request } from "express";
import { ApiResponse, EventName, ProfileEventParams } from "../models/analytics-events";
import { ProfileFields } from "../models/constants";
import { ProfileResponse } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { formatProfileResponse, getProfileDoc, getProfileInsights } from "../utils/profile-utils";

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
    has_name: !!profileData[ProfileFields.NAME],
    has_avatar: !!profileData[ProfileFields.AVATAR],
    has_location: !!profileData[ProfileFields.LOCATION],
    has_birthday: !!profileData[ProfileFields.BIRTHDAY],
    has_notification_settings: Array.isArray(profileData[ProfileFields.NOTIFICATION_SETTINGS]) &&
      profileData[ProfileFields.NOTIFICATION_SETTINGS].length > 0,
    has_gender: !!profileData[ProfileFields.GENDER]
  };

  return {
    data: response,
    status: 200,
    analytics: {
      event: EventName.PROFILE_VIEWED,
      userId: currentUserId,
      params: event
    }
  };
}; 