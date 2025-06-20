import { Request } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { ApiResponse, EventName, FriendshipRemovalEventParams } from '../models/analytics-events.js';
import { Collections } from '../models/constants.js';
import { NotFoundError } from '../utils/errors.js';
import { getFriendDoc, hasReachedCombinedLimit } from '../utils/friendship-utils.js';
import { getLogger } from '../utils/logging-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Removes a friendship between the current user and the specified friend.
 *
 * This function:
 * 1. Ensures migration to the new friend document system
 * 2. Gets the friend count before deletion for analytics
 * 3. Checks if friendship exists using the new system
 * 4. Deletes friend documents from both users' subcollections
 * 5. Returns success response with analytics tracking
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Request parameters containing:
 *                - friend_user_id: The ID of the friend to remove
 *
 * @returns An ApiResponse with null data and analytics
 *
 * @throws 404: Friendship not found
 */
export const removeFriend = async (req: Request): Promise<ApiResponse<null>> => {
  const currentUserId = req.userId;
  const friendUserId = req.params.friend_user_id as string;

  logger.info(`User ${currentUserId} removing friend ${friendUserId}`);

  const db = getFirestore();

  // Get friend count before deletion for analytics
  const { friendCount: friendCountBefore } = await hasReachedCombinedLimit(currentUserId);

  // Check if friendship exists using the new friend document system
  const friendDocResult = await getFriendDoc(currentUserId, friendUserId);

  if (!friendDocResult) {
    logger.warn(`Friendship between ${currentUserId} and ${friendUserId} not found`);
    throw new NotFoundError('Friendship not found');
  }

  // Delete friend documents from both users' subcollections
  const batch = db.batch();

  // Delete current user's friend document about the friend
  const currentUserFriendRef = db
    .collection(Collections.PROFILES)
    .doc(currentUserId)
    .collection(Collections.FRIENDS)
    .doc(friendUserId);
  batch.delete(currentUserFriendRef);

  // Delete friend's friend document about the current user
  const friendUserFriendRef = db
    .collection(Collections.PROFILES)
    .doc(friendUserId)
    .collection(Collections.FRIENDS)
    .doc(currentUserId);
  batch.delete(friendUserFriendRef);

  await batch.commit();

  logger.info(`Removed friendship between ${currentUserId} and ${friendUserId}`);

  // Friend count after deletion
  const friendCountAfter = friendCountBefore - 1;

  // Create analytics event
  const event: FriendshipRemovalEventParams = {
    friend_count_before: friendCountBefore,
    friend_count_after: friendCountAfter,
  };

  return {
    data: null,
    status: 204,
    analytics: {
      event: EventName.FRIENDSHIP_REMOVED,
      userId: currentUserId,
      params: event,
    },
  };
};
