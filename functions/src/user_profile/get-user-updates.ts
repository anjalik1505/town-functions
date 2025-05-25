import { Request } from 'express';
import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { ApiResponse, EventName, UpdateViewEventParams } from '../models/analytics-events.js';
import { Collections, FeedFields, FriendshipFields, QueryOperators, Status } from '../models/constants.js';
import { PaginationPayload, UpdatesResponse } from '../models/data-models.js';
import { BadRequestError, ForbiddenError } from '../utils/errors.js';
import { createFriendshipId } from '../utils/friendship-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { applyPagination, generateNextCursor, processQueryStream } from '../utils/pagination-utils.js';
import { getProfileDoc } from '../utils/profile-utils.js';
import { fetchUpdatesReactions } from '../utils/reaction-utils.js';
import { fetchUpdatesByIds, processFeedItems } from '../utils/update-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Retrieves paginated updates for a specific user.
 * Uses the same approach as get-my-feeds.ts but filters for updates from the target user.
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Pagination parameters containing:
 *                - limit: Maximum number of updates to return
 *                - after_cursor: Cursor for pagination (base64 encoded document path)
 *              - params: Route parameters containing:
 *                - target_user_id: The ID of the user whose updates are being requested
 *
 * @returns An UpdatesResponse containing:
 * - A list of updates created by the specified user
 * - A next_cursor for pagination (if more results are available)
 *
 * @throws 400: Use /me/updates endpoint to view your own updates
 * @throws 404: Profile not found
 * @throws 403: You must be friends with this user to view their updates
 */
export const getUserUpdates = async (req: Request): Promise<ApiResponse<UpdatesResponse>> => {
  const currentUserId = req.userId;
  const targetUserId = req.params.target_user_id;

  logger.info(`Retrieving updates for user ${targetUserId} requested by ${currentUserId}`);

  const db = getFirestore();

  if (!targetUserId) {
    throw new BadRequestError('Target user ID is required');
  }

  // Redirect users to the appropriate endpoint for their own updates
  if (currentUserId === targetUserId) {
    logger.warn(`User ${currentUserId} attempted to view their own updates through /user endpoint`);
    throw new BadRequestError('Use /me/updates endpoint to view your own updates');
  }

  // Get pagination parameters from the validated request
  const validatedParams = req.validated_params as PaginationPayload;
  const limit = validatedParams?.limit || 20;
  const afterCursor = validatedParams?.after_cursor;

  logger.info(`Pagination parameters - limit: ${limit}, after_cursor: ${afterCursor}`);

  // Get the target user's profile
  await getProfileDoc(targetUserId);

  // Get the current user's profile
  await getProfileDoc(currentUserId);

  // Check if users are friends using the unified friendships collection
  const friendshipId = createFriendshipId(currentUserId, targetUserId);
  const friendshipRef = db.collection(Collections.FRIENDSHIPS).doc(friendshipId);
  const friendshipDoc = await friendshipRef.get();

  // If they are not friends, return an error
  if (!friendshipDoc.exists || friendshipDoc.data()?.[FriendshipFields.STATUS] !== Status.ACCEPTED) {
    logger.warn(`User ${currentUserId} attempted to view updates of non-friend ${targetUserId}`);
    throw new ForbiddenError('You must be friends with this user to view their updates');
  }

  logger.info(`Friendship verified between ${currentUserId} and ${targetUserId}`);

  // Initialize the feed query
  let feedQuery = db
    .collection(Collections.USER_FEEDS)
    .doc(currentUserId)
    .collection(Collections.FEED)
    .where(FeedFields.CREATED_BY, QueryOperators.EQUALS, targetUserId)
    .orderBy(FeedFields.CREATED_AT, QueryOperators.DESC);

  // Apply cursor-based pagination - Express will automatically catch errors
  const paginatedQuery = await applyPagination(feedQuery, afterCursor, limit);

  // Process feed items using streaming
  const { items: feedDocs, lastDoc } = await processQueryStream<QueryDocumentSnapshot>(
    paginatedQuery,
    (doc) => doc,
    limit,
  );

  if (feedDocs.length === 0) {
    logger.info(`No updates found for user ${targetUserId}`);
    const emptyEvent: UpdateViewEventParams = {
      update_count: 0,
      user: targetUserId,
    };
    return {
      data: { updates: [], next_cursor: null },
      status: 200,
      analytics: {
        event: EventName.FRIEND_UPDATES_VIEWED,
        userId: currentUserId,
        params: emptyEvent,
      },
    };
  }

  // Get all update IDs from feed items
  const updateIds = feedDocs.map((doc) => doc.data()[FeedFields.UPDATE_ID]);

  // Fetch all updates in parallel
  const updateMap = await fetchUpdatesByIds(updateIds);

  // Fetch reactions for all updates
  const updateReactionsMap = await fetchUpdatesReactions(updateIds);

  // Process feed items and create updates
  const updates = processFeedItems(feedDocs, updateMap, updateReactionsMap, targetUserId);

  // Set up pagination for the next request
  const nextCursor = generateNextCursor(lastDoc, feedDocs.length, limit);

  logger.info(`Retrieved ${updates.length} updates for user ${targetUserId}`);
  const event: UpdateViewEventParams = {
    update_count: updates.length,
    user: targetUserId,
  };
  return {
    data: { updates, next_cursor: nextCursor },
    status: 200,
    analytics: {
      event: EventName.FRIEND_UPDATES_VIEWED,
      userId: currentUserId,
      params: event,
    },
  };
};
