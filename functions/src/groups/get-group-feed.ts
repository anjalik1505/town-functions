import { Request, Response } from 'express';
import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { Collections, QueryOperators } from '../models/constants.js';
import { FeedResponse, PaginationPayload } from '../models/data-models.js';
import { FeedDoc, groupConverter, UpdateDoc, updateConverter, uf } from '../models/firestore/index.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { applyPagination, generateNextCursor, processQueryStream } from '../utils/pagination-utils.js';
import { fetchUpdatesByIds, processEnrichedFeedItems } from '../utils/update-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Retrieves all updates for a specific group, paginated.
 *
 * This function fetches updates that include the specified group ID in their group_ids array.
 * The updates are returned in descending order by creation time (newest first) and
 * support pagination for efficient data loading.
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Pagination parameters containing:
 *                - limit: Maximum number of updates to return
 *                - after_cursor: Cursor for pagination (base64 encoded document path)
 * @param res - The Express response object
 * @param groupId - The ID of the group to retrieve updates for
 *
 * Query Parameters:
 * - limit: Maximum number of updates to return (default: 20, min: 1, max: 100)
 * - after_cursor: Cursor for pagination (base64 encoded document path)
 *
 * @returns A FeedResponse containing:
 * - A list of updates for the specified group
 * - A next_cursor for pagination (if more results are available)
 *
 * @throws 404: Group not found
 * @throws 403: User is not a member of the group
 * @throws 500: Internal server error
 */
export const getGroupFeed = async (req: Request, res: Response, groupId: string): Promise<void> => {
  logger.info(`Retrieving feed for group: ${groupId}`);

  // Get the authenticated user ID from the request
  const currentUserId = req.userId;

  // Initialize Firestore client
  const db = getFirestore();

  // Get pagination parameters from the validated request
  const validatedParams = req.validated_params as PaginationPayload;
  const limit = validatedParams?.limit || 20;
  const afterCursor = validatedParams?.after_cursor;

  logger.info(`Pagination parameters - limit: ${limit}, after_cursor: ${afterCursor}`);

  // First, check if the group exists and if the user is a member
  const groups = db.collection(Collections.GROUPS).withConverter(groupConverter);
  const groupRef = groups.doc(groupId);
  const groupDoc = await groupRef.get();

  const groupData = groupDoc.data();
  if (!groupData) {
    logger.warn(`Group ${groupId} not found`);
    throw new NotFoundError('Group not found');
  }

  const members = groupData.members || [];

  // Check if the current user is a member of the group
  if (!members.includes(currentUserId)) {
    logger.warn(`User ${currentUserId} is not a member of group ${groupId}`);
    throw new ForbiddenError('You must be a member of the group to view its feed');
  }

  // Build the query for updates from this group
  let query = db
    .collection(Collections.UPDATES)
    .withConverter(updateConverter)
    .where(uf('group_ids'), QueryOperators.ARRAY_CONTAINS, groupId)
    .orderBy(uf('created_at'), QueryOperators.DESC);

  // Apply cursor-based pagination - Express will automatically catch errors
  const paginatedQuery = await applyPagination(query, afterCursor, limit);

  // Process updates using streaming
  const { items: updateDocs, lastDoc } = await processQueryStream<QueryDocumentSnapshot>(
    paginatedQuery,
    (doc) => doc,
    limit,
  );

  // Get all update IDs from the query results
  const updateIds = updateDocs.map((updateDoc) => updateDoc.id);

  // Fetch update data using util
  const updateMap = await fetchUpdatesByIds(updateIds);

  // Convert update documents to feed documents for processEnrichedFeedItems
  const feedDocs = updateDocs.map((updateDoc) => {
    const updateData = updateDoc.data() as UpdateDoc;
    const feedData: FeedDoc = {
      update_id: updateDoc.id,
      created_at: updateData.created_at,
      created_by: updateData.created_by,
      direct_visible: false,
      friend_id: undefined,
      group_ids: updateData.group_ids || [],
    };
    return {
      id: updateDoc.id,
      data: () => feedData,
    } as QueryDocumentSnapshot<FeedDoc>;
  });

  // Use util to enrich updates
  const enrichedUpdates = await processEnrichedFeedItems(feedDocs, updateMap);

  logger.info('Query executed successfully');

  // Set up pagination for the next request
  const nextCursor = generateNextCursor(lastDoc, enrichedUpdates.length, limit);

  logger.info(`Retrieved ${enrichedUpdates.length} updates for group: ${groupId}`);

  // Return the response
  const response: FeedResponse = {
    updates: enrichedUpdates,
    next_cursor: nextCursor,
  };

  res.json(response);
};
