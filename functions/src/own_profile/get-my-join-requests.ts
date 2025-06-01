import { Request } from 'express';
import { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { ApiResponse, EventName, InviteJoinEventParams } from '../models/analytics-events.js';
import { Collections, JoinRequestFields, QueryOperators } from '../models/constants.js';
import { JoinRequest, JoinRequestResponse, PaginationPayload } from '../models/data-models.js';
import { formatJoinRequest, getInvitationDocForUser, validateJoinRequestOwnership } from '../utils/invitation-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { applyPagination, generateNextCursor, processQueryStream } from '../utils/pagination-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Gets all join requests for an invitation owned by the current user.
 *
 * This function:
 * 1. Validates the invitation exists and the current user is the owner
 * 2. Retrieves all join requests for the invitation
 * 3. Paginates the results based on the provided limit and cursor
 * 4. Returns the paginated join requests
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Request parameters containing:
 *                - invitation_id: The ID of the invitation to get join requests for
 *              - validated_params: The validated query parameters containing:
 *                - limit: Maximum number of join requests to return (default: 20)
 *                - after_cursor: Cursor for pagination (optional)
 *
 * @returns An ApiResponse containing the paginated join requests and analytics
 *
 * @throws 400: Invalid pagination parameters (if validation fails)
 * @throws 403: You are not authorized to view these join requests
 * @throws 404: Invitation not found
 */
export const getMyJoinRequests = async (req: Request): Promise<ApiResponse<JoinRequestResponse>> => {
  // Get validated params
  const validatedData = req.validated_params as PaginationPayload;
  const currentUserId = req.userId;
  const limit = validatedData.limit || 20;
  const afterCursor = validatedData.after_cursor;

  logger.info(`Getting join requests for user ${currentUserId} with limit: ${limit}, after_cursor: ${afterCursor}`);

  // Get the invitation and validate ownership
  const { ref: invitationRef, data: invitationData } = await getInvitationDocForUser(currentUserId);
  const senderId = invitationData.sender_id as string;

  // Validate that the current user is the invitation owner
  validateJoinRequestOwnership(senderId, currentUserId);

  // Build the query on the subcollection
  let query = invitationRef
    .collection(Collections.JOIN_REQUESTS)
    .orderBy(JoinRequestFields.CREATED_AT, QueryOperators.DESC);

  // Apply cursor-based pagination
  const paginatedQuery = await applyPagination(query, afterCursor, limit);

  // Process join requests using streaming
  const { items: requestDocs, lastDoc } = await processQueryStream<QueryDocumentSnapshot>(
    paginatedQuery,
    (doc) => doc,
    limit,
  );

  if (requestDocs.length === 0) {
    logger.info(`No join requests found for invitation ${invitationRef.id}`);

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
  const joinRequests: JoinRequest[] = requestDocs.map((doc) => formatJoinRequest(doc.id, doc.data()));

  // Generate next cursor if there are more results
  const nextCursor = generateNextCursor(lastDoc, requestDocs.length, limit);

  logger.info(`Found ${joinRequests.length} join requests for invitation ${invitationRef.id}`);

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
