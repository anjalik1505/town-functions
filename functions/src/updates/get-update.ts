import { Request } from 'express';
import { ApiResponse, EventName, UpdateViewEventWithCommentsParams } from '../models/analytics-events.js';
import { UpdateFields } from '../models/constants.js';
import { PaginationPayload, UpdateWithCommentsResponse } from '../models/data-models.js';
import { BadRequestError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { fetchUsersProfiles } from '../utils/profile-utils.js';
import { fetchUpdateReactions } from '../utils/reaction-utils.js';
import {
  fetchFriendProfiles,
  fetchGroupProfiles,
  fetchUpdateComments,
  formatEnrichedUpdate,
  getUpdateDoc,
  hasUpdateAccess,
} from '../utils/update-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Retrieves a single update with its comments.
 *
 * This function:
 * 1. Verifies the user has access to the update using visibility identifiers or all_village flag
 * 2. Fetches the update data
 * 3. Fetches the first page of comments
 * 4. Enriches the update and comments with profile data
 * 5. Returns the update with comments and a next_cursor for pagination
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Route parameters containing:
 *                - update_id: The ID of the update to retrieve
 *              - query: Query parameters containing:
 *                - limit: Maximum number of comments to return (default: 10, min: 1, max: 100)
 *                - after_cursor: Cursor for comment pagination (base64 encoded document path)
 *
 * @returns An ApiResponse containing the update with comments and analytics data
 *
 * @throws 400: Invalid request parameters
 * @throws 403: You don't have access to this update
 * @throws 404: Update not found
 */
export const getUpdate = async (req: Request): Promise<ApiResponse<UpdateWithCommentsResponse>> => {
  const updateId = req.params.update_id;
  const currentUserId = req.userId;
  logger.info(`Retrieving update: ${updateId}`);

  // Get pagination parameters for comments
  const validatedParams = req.validated_params as PaginationPayload;
  const limit = validatedParams?.limit || 20;
  const afterCursor = validatedParams?.after_cursor;

  if (!updateId) {
    throw new BadRequestError('Update ID is required');
  }

  // Get the update document to check access
  const updateResult = await getUpdateDoc(updateId);
  await hasUpdateAccess(updateResult.data, currentUserId);

  // Fetch the update's reactions
  const reactions = await fetchUpdateReactions(updateId);

  // Get the creator's profile
  const creatorId = updateResult.data.created_by;
  const creatorProfiles = await fetchUsersProfiles([creatorId]);
  const creatorProfile = creatorProfiles.get(creatorId);

  // Fetch shared_with profiles
  const friendIds = updateResult.data[UpdateFields.FRIEND_IDS] || [];
  const groupIds = updateResult.data[UpdateFields.GROUP_IDS] || [];
  const [sharedWithFriends, sharedWithGroups] = await Promise.all([
    fetchFriendProfiles(friendIds),
    fetchGroupProfiles(groupIds),
  ]);

  // Create the enriched update
  const enrichedUpdate = formatEnrichedUpdate(
    updateId,
    updateResult.data,
    creatorId,
    reactions,
    creatorProfile || null,
    sharedWithFriends,
    sharedWithGroups,
  );

  // Fetch and process the first page of comments
  const {
    comments: enrichedComments,
    uniqueCreatorCount,
    nextCursor,
  } = await fetchUpdateComments(updateResult.ref, limit, afterCursor);

  const response: UpdateWithCommentsResponse = {
    update: enrichedUpdate,
    comments: enrichedComments,
    next_cursor: nextCursor,
  };

  // Create analytics event
  const event: UpdateViewEventWithCommentsParams = {
    comment_count: enrichedComments.length,
    reaction_count: enrichedUpdate.reaction_count,
    unique_creators: uniqueCreatorCount,
    user: creatorId,
  };

  return {
    data: response,
    status: 200,
    analytics: {
      event: EventName.UPDATES_VIEWED,
      userId: currentUserId,
      params: event,
    },
  };
};
