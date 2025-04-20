import { Request } from "express";
import { ApiResponse, EventName, ProfileEventParams } from "../models/analytics-events";
import { Collections, Documents, ProfileFields } from "../models/constants";
import { getLogger } from "../utils/logging-utils";
import { getProfileDoc } from "../utils/profile-utils";

const logger = getLogger(__filename);

/**
 * Deletes the profile of the authenticated user.
 *
 * This function:
 * 1. Checks if a profile exists for the authenticated user
 * 2. If it exists, deletes the insights subcollection
 * 3. Then deletes the profile document
 *
 * Note: The actual deletion of related data (updates, friendships, etc.) is handled by a Firestore trigger
 * that listens for profile deletions.
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *
 * @returns 204 No Content on successful deletion
 *
 * @throws 404: Profile not found for user {user_id}
 */
export const deleteProfile = async (req: Request): Promise<ApiResponse<null>> => {
  const currentUserId = req.userId;
  logger.info(`Starting delete_profile operation for user ID: ${currentUserId}`);

  // Get the profile document using the utility function (throws NotFoundError if not found)
  const {ref: profileRef, data: profileData} = await getProfileDoc(currentUserId);

  // Delete the insights subcollection first
  const insightsRef = profileRef.collection(Collections.INSIGHTS).doc(Documents.DEFAULT_INSIGHTS);
  const insightsDoc = await insightsRef.get();
  if (insightsDoc.exists) {
    await insightsRef.delete();
    logger.info(`Deleted insights document for user ${currentUserId}`);
  }

  // Delete the profile document
  await profileRef.delete();
  logger.info(`Profile document deleted for user ${currentUserId}`);

  // Track profile deletion event
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
    data: null,
    status: 204,
    analytics: {
      event: EventName.PROFILE_DELETED,
      userId: currentUserId,
      params: event
    }
  };
};
