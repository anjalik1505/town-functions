import { Request } from 'express';
import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { ApiResponse, EventName, ProfileEventParams } from '../models/analytics-events.js';
import { Collections, ProfileFields } from '../models/constants.js';
import { migrateFriendDocsForUser } from '../utils/friendship-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import {
  extractConnectToForAnalytics,
  extractGoalForAnalytics,
  extractNudgingOccurrence,
  getProfileDoc,
} from '../utils/profile-utils.js';

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

  const db = getFirestore();

  // Ensure user's friend documents are migrated from old FRIENDSHIPS collection
  await migrateFriendDocsForUser(currentUserId);

  // Extract friends list from subcollection before deletion
  const friendIds: string[] = [];
  const friendsQuery = profileRef.collection(Collections.FRIENDS);

  try {
    for await (const doc of friendsQuery.stream()) {
      const friendDoc = doc as unknown as QueryDocumentSnapshot;
      friendIds.push(friendDoc.id);
    }
    logger.info(`Found ${friendIds.length} friends for user ${currentUserId}`);
  } catch (error) {
    logger.warn(`Error reading friends subcollection for user ${currentUserId}: ${error}`);
    // Continue with deletion even if friends list extraction fails
  }

  // Store friends list in profile document for trigger to use
  if (friendIds.length > 0) {
    await profileRef.update({
      [ProfileFields.FRIENDS_TO_CLEANUP]: friendIds,
    });
    logger.info(`Stored ${friendIds.length} friend IDs in profile document for cleanup`);
  }

  // Use recursiveDelete to delete the profile document and all its subcollections
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
    nudging_occurrence: extractNudgingOccurrence(profileData),
    has_gender: !!profileData[ProfileFields.GENDER],
    goal: extractGoalForAnalytics(profileData),
    connect_to: extractConnectToForAnalytics(profileData),
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
