import { Request } from 'express';
import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import {
  ApiResponse,
  EventName,
  UpdateViewEventParams,
} from '../models/analytics-events';
import { Collections, FeedFields, QueryOperators } from '../models/constants';
import { UpdatesResponse } from '../models/data-models';
import { getLogger } from '../utils/logging-utils';
import {
  applyPagination,
  generateNextCursor,
  processQueryStream,
} from '../utils/pagination-utils';
import { getProfileDoc } from '../utils/profile-utils';
import { fetchUpdatesReactions } from '../utils/reaction-utils';
import { fetchUpdatesByIds, processFeedItems } from '../utils/update-utils';

const logger = getLogger(__filename);

/**
 * Retrieves the current user's updates in a paginated format.
 * Uses the same approach as get-my-feeds.ts but filters for updates created by the current user.
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Pagination parameters containing:
 *                - limit: Maximum number of updates to return (default: 20, min: 1, max: 100)
 *                - after_cursor: Cursor for pagination (base64 encoded document path)
 *
 * @returns An UpdatesResponse containing:
 * - A list of updates belonging to the current user
 * - A next_cursor for pagination (if more results are available)
 */
export const getUpdates = async (
  req: Request,
): Promise<ApiResponse<UpdatesResponse>> => {
  const currentUserId = req.userId;
  logger.info(`Retrieving updates for user: ${currentUserId}`);

  const db = getFirestore();

  // Get pagination parameters from the validated request
  const validatedParams = req.validated_params;
  const limit = validatedParams?.limit || 20;
  const afterCursor = validatedParams?.after_cursor;

  logger.info(
    `Pagination parameters - limit: ${limit}, after_cursor: ${afterCursor}`,
  );

  // Get the user's profile first to verify existence
  await getProfileDoc(currentUserId);

  // Initialize the feed query
  let feedQuery = db
    .collection(Collections.USER_FEEDS)
    .doc(currentUserId)
    .collection(Collections.FEED)
    .where(FeedFields.CREATED_BY, QueryOperators.EQUALS, currentUserId)
    .orderBy(FeedFields.CREATED_AT, QueryOperators.DESC);

  // Apply cursor-based pagination - errors will be automatically caught by Express
  const paginatedQuery = await applyPagination(feedQuery, afterCursor, limit);

  // Process feed items using streaming
  const { items: feedDocs, lastDoc } =
    await processQueryStream<QueryDocumentSnapshot>(
      paginatedQuery,
      (doc) => doc,
      limit,
    );

  if (feedDocs.length === 0) {
    logger.info(`No updates found for user ${currentUserId}`);
    const emptyEvent: UpdateViewEventParams = {
      update_count: 0,
      user: currentUserId,
    };
    return {
      data: { updates: [], next_cursor: null },
      status: 200,
      analytics: {
        event: EventName.UPDATES_VIEWED,
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
  const updates = processFeedItems(
    feedDocs,
    updateMap,
    updateReactionsMap,
    currentUserId,
  );

  // Set up pagination for the next request
  const nextCursor = generateNextCursor(lastDoc, feedDocs.length, limit);

  logger.info(`Retrieved ${updates.length} updates for user ${currentUserId}`);
  const event: UpdateViewEventParams = {
    update_count: updates.length,
    user: currentUserId,
  };
  return {
    data: { updates, next_cursor: nextCursor },
    status: 200,
    analytics: {
      event: EventName.UPDATES_VIEWED,
      userId: currentUserId,
      params: event,
    },
  };
};
