import { Request } from 'express';
import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { ApiResponse, EventName, FriendEventParams } from '../models/analytics-events.js';
import { Collections, QueryOperators } from '../models/constants.js';
import { FriendDoc, friendConverter, ff } from '../models/firestore/friend-doc.js';
import { Friend, FriendsResponse, PaginationPayload } from '../models/data-models.js';
import { getLogger } from '../utils/logging-utils.js';
import { applyPagination, generateNextCursor, processQueryStream } from '../utils/pagination-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Retrieves the current user's friends and pending friendship requests.
 *
 * This function fetches all accepted and pending friendships where the current user
 * is in the member array and returns the friend's information with status.
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Pagination parameters containing:
 *                - limit: Maximum number of friends to return (default: 20, min: 1, max: 100)
 *                - after_cursor: Cursor for pagination (base64 encoded document path)
 *
 * @returns An ApiResponse containing the friend's response and analytics
 */
export const getMyFriends = async (req: Request): Promise<ApiResponse<FriendsResponse>> => {
  const db = getFirestore();
  const currentUserId = req.userId;

  logger.info(`Retrieving friends and pending requests for user: ${currentUserId}`);

  // Get pagination parameters from the validated request
  const validatedParams = req.validated_params as PaginationPayload;
  const limit = validatedParams?.limit || 20;
  const afterCursor = validatedParams?.after_cursor;

  logger.info(`Pagination parameters - limit: ${limit}, after_cursor: ${afterCursor}`);

  let query = db
    .collection(Collections.PROFILES)
    .doc(currentUserId)
    .collection(Collections.FRIENDS)
    .withConverter(friendConverter)
    .orderBy(ff('last_update_at'), QueryOperators.DESC);

  // Apply cursor-based pagination - Express will automatically catch errors
  const paginatedQuery = await applyPagination(query, afterCursor, limit);

  // Process friendships using streaming
  const { items: friendshipDocs, lastDoc } = await processQueryStream<QueryDocumentSnapshot>(
    paginatedQuery,
    (doc) => doc,
    limit,
  );

  const friends: Friend[] = [];

  // Process friendships
  for (const friendshipDoc of friendshipDocs) {
    const friendshipData = friendshipDoc.data() as FriendDoc;

    const friend: Friend = {
      user_id: friendshipDoc.id,
      username: friendshipData.username || '',
      name: friendshipData.name || '',
      avatar: friendshipData.avatar || '',
      last_update_emoji: friendshipData.last_update_emoji || '',
      last_update_time: (() => {
        const ts = friendshipData.last_update_at;
        return ts ? formatTimestamp(ts) : '';
      })(),
    };

    logger.info(`Processing friendship with friend: ${friend.user_id}`);

    friends.push(friend);
  }

  // Set up pagination for the next request
  const nextCursor = generateNextCursor(lastDoc, friends.length, limit);

  logger.info(`Retrieved ${friends.length} friends and pending requests for user: ${currentUserId}`);

  // Create analytics event
  const event: FriendEventParams = {
    friend_count: friends.length,
  };

  // Return the list of friends with pagination info
  const response: FriendsResponse = { friends, next_cursor: nextCursor };

  return {
    data: response,
    status: 200,
    analytics: {
      event: EventName.FRIENDS_VIEWED,
      userId: currentUserId,
      params: event,
    },
  };
};
