import { Request } from 'express';
import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { ApiResponse, EventName, FeedViewEventParams } from '../models/analytics-events.js';
import { Collections, FeedFields, QueryOperators } from '../models/constants.js';
import { FeedResponse, PaginationPayload } from '../models/data-models.js';
import { getLogger } from '../utils/logging-utils.js';
import { applyPagination, generateNextCursor, processQueryStream } from '../utils/pagination-utils.js';
import { fetchUsersProfiles, getProfileDoc } from '../utils/profile-utils.js';
import { fetchUpdatesReactions } from '../utils/reaction-utils.js';
import { fetchUpdatesByIds, processEnrichedFeedItems } from '../utils/update-utils.js';

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Retrieves the user's feed of updates, paginated using cursor-based pagination.
 *
 * This function:
 * 1. Queries the user's feed collection directly
 * 2. Uses cursor-based pagination for efficient data loading
 * 3. Fetches the full update content for each feed item
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Pagination parameters containing:
 *                - limit: Maximum number of updates to return (default: 20, min: 1, max: 100)
 *                - after_cursor: Cursor for pagination (Base64 encoded document reference)
 *
 * @returns A FeedResponse containing:
 * - A list of enriched updates from the user's feed
 * - A next_cursor for pagination (if more results are available)
 */
export const getFeeds = async (req: Request): Promise<ApiResponse<FeedResponse>> => {
  const currentUserId = req.userId;
  logger.info(`Retrieving feed for user: ${currentUserId}`);

  const db = getFirestore();

  // Get pagination parameters from the validated request
  const validatedParams = req.validated_params as PaginationPayload;
  const limit = validatedParams?.limit || 20;
  const afterCursor = validatedParams?.after_cursor;

  logger.info(`Pagination parameters - limit: ${limit}, after_cursor: ${afterCursor}`);

  // Get the user's profile first to verify existence
  await getProfileDoc(currentUserId);

  // Initialize the feed query
  let feedQuery = db
    .collection(Collections.USER_FEEDS)
    .doc(currentUserId)
    .collection(Collections.FEED)
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
    logger.info(`No feed items found for user ${currentUserId}`);
    const emptyEvent: FeedViewEventParams = {
      update_count: 0,
      unique_creators: 0,
    };
    return {
      data: { updates: [], next_cursor: null },
      status: 200,
      analytics: {
        event: EventName.FEED_VIEWED,
        userId: currentUserId,
        params: emptyEvent,
      },
    };
  }

  // Get all update IDs from feed items
  const updateIds = feedDocs.map((doc) => doc.data()[FeedFields.UPDATE_ID]);

  // Fetch all updates in parallel
  const updateMap = await fetchUpdatesByIds(updateIds);

  // Get unique user IDs from the updates
  const uniqueUserIds = Array.from(new Set(feedDocs.map((doc) => doc.data()[FeedFields.CREATED_BY])));

  // Fetch all user profiles in parallel
  const profiles = await fetchUsersProfiles(uniqueUserIds);

  // Fetch reactions for all updates
  const updateReactionsMap = await fetchUpdatesReactions(updateIds);

  // Process feed items and create enriched updates
  const enrichedUpdates = processEnrichedFeedItems(feedDocs, updateMap, updateReactionsMap, profiles);

  // Set up pagination for the next request
  const nextCursor = generateNextCursor(lastDoc, feedDocs.length, limit);

  logger.info(`Retrieved ${enrichedUpdates.length} updates for user ${currentUserId}`);
  const event: FeedViewEventParams = {
    update_count: enrichedUpdates.length,
    unique_creators: uniqueUserIds.length,
  };
  return {
    data: { updates: enrichedUpdates, next_cursor: nextCursor },
    status: 200,
    analytics: {
      event: EventName.FEED_VIEWED,
      userId: currentUserId,
      params: event,
    },
  };
};
