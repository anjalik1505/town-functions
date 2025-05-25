import { Request } from 'express';
import { ApiResponse, CommentViewEventParams, EventName } from '../models/analytics-events.js';
import { CommentsResponse, PaginationPayload } from '../models/data-models.js';
import { BadRequestError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { fetchUpdateComments, getUpdateDoc, hasUpdateAccess } from '../utils/update-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Retrieves paginated comments for an update.
 *
 * This function:
 * 1. Verifies the user has access to the update using visibility identifiers
 * 2. Fetches paginated comments
 * 3. Enriches comments with profile data
 * 4. Returns comments in descending order by creation time
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Pagination parameters containing:
 *                - limit: Maximum number of comments to return (default: 20, min: 1, max: 100)
 *                - after_cursor: Cursor for pagination (base64 encoded document path)
 *              - params: Route parameters containing:
 *                - update_id: The ID of the update to get comments for
 *
 * @returns An ApiResponse containing the comments and analytics data
 *
 * @throws 400: Invalid query parameters
 * @throws 403: You don't have access to this update
 * @throws 404: Update not found
 */
export const getComments = async (req: Request): Promise<ApiResponse<CommentsResponse>> => {
  const updateId = req.params.update_id;
  const currentUserId = req.userId;
  logger.info(`Retrieving comments for update: ${updateId}`);

  // Get pagination parameters
  const validatedParams = req.validated_params as PaginationPayload;
  const limit = validatedParams?.limit || 20;
  const afterCursor = validatedParams?.after_cursor;

  if (!updateId) {
    throw new BadRequestError('Update ID is required');
  }

  // Get the update document to check access
  const updateResult = await getUpdateDoc(updateId);
  await hasUpdateAccess(updateResult.data, currentUserId);

  // Use the utility function to fetch and process comments
  const {
    comments: enrichedComments,
    uniqueCreatorCount,
    nextCursor,
  } = await fetchUpdateComments(updateResult.ref, limit, afterCursor);

  const response: CommentsResponse = {
    comments: enrichedComments,
    next_cursor: nextCursor,
  };

  // Create analytics event
  const event: CommentViewEventParams = {
    comment_count: updateResult.data.comment_count || 0,
    reaction_count: updateResult.data.reaction_count || 0,
    unique_creators: uniqueCreatorCount,
  };

  return {
    data: response,
    status: 200,
    analytics: {
      event: EventName.COMMENTS_VIEWED,
      userId: currentUserId,
      params: event,
    },
  };
};
