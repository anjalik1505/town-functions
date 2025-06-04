import { Request } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { ApiResponse, EventName, ProfileEventParams } from '../models/analytics-events.js';
import { ProfileFields } from '../models/constants.js';
import { getLogger } from '../utils/logging-utils.js';
import { getProfileDoc } from '../utils/profile-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Deletes the profile of the authenticated user.
 *
 * This function:
 * 1. Checks if a profile exists for the authenticated user
 * 2. If it exists, deletes insights subcollection
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
  const { ref: profileRef, data: profileData } = await getProfileDoc(currentUserId);

  // Use recursiveDelete to delete the profile document and all its subcollections
  const db = getFirestore();
  await db.recursiveDelete(profileRef);
  logger.info(`Profile document and all subcollections deleted for user ${currentUserId}`);

  // Track profile deletion event
  const event: ProfileEventParams = {
    has_name: !!profileData[ProfileFields.NAME],
    has_avatar: !!profileData[ProfileFields.AVATAR],
    has_location: !!profileData[ProfileFields.LOCATION],
    has_birthday: !!profileData[ProfileFields.BIRTHDAY],
    has_notification_settings:
      Array.isArray(profileData[ProfileFields.NOTIFICATION_SETTINGS]) &&
      profileData[ProfileFields.NOTIFICATION_SETTINGS].length > 0,
    nudging_occurrence: (profileData[ProfileFields.NUDGING_SETTINGS] as any)?.occurrence || '',
    has_gender: !!profileData[ProfileFields.GENDER],
    goal: (profileData[ProfileFields.GOAL] as string) || '',
    connect_to: (profileData[ProfileFields.CONNECT_TO] as string) || '',
    personality: (profileData[ProfileFields.PERSONALITY] as string) || '',
    tone: (profileData[ProfileFields.TONE] as string) || '',
  };

  return {
    data: null,
    status: 204,
    analytics: {
      event: EventName.PROFILE_DELETED,
      userId: currentUserId,
      params: event,
    },
  };
};
