import { Request } from 'express';
import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { ApiResponse, EventName, InviteJoinEventParams } from '../models/analytics-events.js';
import { Collections, QueryOperators } from '../models/constants.js';
import { JoinRequest, JoinRequestResponse, PaginationPayload } from '../models/data-models.js';
import { JoinRequestDoc, jrf } from '../models/firestore/join-request-doc.js';
import { formatJoinRequest } from '../utils/invitation-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { applyPagination, generateNextCursor, processQueryStream } from '../utils/pagination-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Gets all join requests made by the current user.
 *
 * This function:
 * 1. Retrieves all join requests where the current user is the requester
 * 2. Paginates the results based on the provided limit and cursor
 * 3. Returns the paginated join requests
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: The validated query parameters containing:
 *                - limit: Maximum number of join requests to return (default: 20)
 *                - after_cursor: Cursor for pagination (optional)
 *
 * @returns An ApiResponse containing the paginated join requests and analytics
 *
 * @throws 400: Invalid pagination parameters (if validation fails)
 */
export const getJoinRequests = async (req: Request): Promise<ApiResponse<JoinRequestResponse>> => {
  // Get validated params
  const validatedData = req.validated_params as PaginationPayload;
  const currentUserId = req.userId;
  const limit = validatedData.limit || 20;
  const afterCursor = validatedData.after_cursor;

  logger.info(`Getting join requests for user ${currentUserId} with limit: ${limit}, after_cursor: ${afterCursor}`);

  const db = getFirestore();

  // Use collection group query to search across all subcollections named JOIN_REQUESTS
  let query = db
    .collectionGroup(Collections.JOIN_REQUESTS)
    .where(jrf('requester_id'), QueryOperators.EQUALS, currentUserId)
    .orderBy(jrf('created_at'), QueryOperators.DESC);

  // Apply cursor-based pagination
  const paginatedQuery = await applyPagination(query, afterCursor, limit);

  // Process join requests using streaming
  const { items: requestDocs, lastDoc } = await processQueryStream<QueryDocumentSnapshot>(
    paginatedQuery,
    (doc) => doc,
    limit,
  );

  if (requestDocs.length === 0) {
    logger.info(`No join requests found for user ${currentUserId}`);

    const event: InviteJoinEventParams = {
      join_request_count: 0,
    };

    return {
      data: {
        join_requests: [],
        next_cursor: null,
      },
      status: 200,
      analytics: {
        event: EventName.JOIN_REQUESTS_VIEWED,
        userId: currentUserId,
        params: event,
      },
    };
  }

  // Format the join requests
  const joinRequests: JoinRequest[] = requestDocs.map((doc) => formatJoinRequest(doc.id, doc.data() as JoinRequestDoc));

  // Generate next cursor if there are more results
  const nextCursor = generateNextCursor(lastDoc, requestDocs.length, limit);

  logger.info(`Found ${joinRequests.length} join requests for user ${currentUserId}`);

  const event: InviteJoinEventParams = {
    join_request_count: joinRequests.length,
  };

  // Return the join requests
  return {
    data: {
      join_requests: joinRequests,
      next_cursor: nextCursor,
    },
    status: 200,
    analytics: {
      event: EventName.JOIN_REQUESTS_VIEWED,
      userId: currentUserId,
      params: event,
    },
  };
};
