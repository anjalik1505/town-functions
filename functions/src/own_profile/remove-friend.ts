import { Request } from 'express';
import { ApiResponse, EventName } from '../models/analytics-events.js';
import { NotFoundError } from '../utils/errors.js';
import { getFriendshipRefAndDoc } from '../utils/friendship-utils.js';
import { getLogger } from '../utils/logging-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Removes a friendship between the current user and the specified friend.
 *
 * This function:
 * 1. Finds the friendship document between the two users
 * 2. Deletes the friendship document
 * 3. Returns success response
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

  // Find the friendship document
  const { ref: friendshipRef, doc: friendshipDoc } = await getFriendshipRefAndDoc(currentUserId, friendUserId);

  // Check if friendship exists
  if (!friendshipDoc.exists) {
    logger.warn(`Friendship between ${currentUserId} and ${friendUserId} not found`);
    throw new NotFoundError('Friendship not found');
  }

  // Delete the friendship document
  await friendshipRef.delete();

  logger.info(`Removed friendship between ${currentUserId} and ${friendUserId}`);

  return {
    data: null,
    status: 204,
    analytics: {
      event: EventName.FRIENDSHIP_REMOVED,
      userId: currentUserId,
      params: {},
    },
  };
};
