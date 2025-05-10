import { Request } from 'express';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { ApiResponse, CommentEventParams, EventName, } from '../models/analytics-events.js';
import { Collections, CommentFields, ProfileFields } from '../models/constants.js';
import { Comment } from '../models/data-models.js';
import { formatComment } from '../utils/comment-utils.js';
import { BadRequestError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { getProfileDoc } from '../utils/profile-utils.js';
import { getUpdateDoc, hasUpdateAccess } from '../utils/update-utils.js';

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Creates a new comment on an update.
 *
 * This function:
 * 1. Verifies the user has access to the update using visibility identifiers
 * 2. Creates a new comment document
 * 3. Updates the comment count on the update
 * 4. Returns the created comment with profile data
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Comment data containing:
 *                - content: The comment text
 *              - params: Route parameters containing:
 *                - update_id: The ID of the update to comment on
 *
 * @returns An ApiResponse containing the created comment and analytics
 *
 * @throws 400: Invalid request parameters
 * @throws 403: You don't have access to this update
 * @throws 404: Update not found
 */
export const createComment = async (
  req: Request,
): Promise<ApiResponse<Comment>> => {
  const updateId = req.params.update_id;
  const currentUserId = req.userId;
  logger.info(`Creating comment on update: ${updateId}`);

  const db = getFirestore();

  if (!updateId) {
    throw new BadRequestError('Update ID is required');
  }

  // Get the update document to check access
  const updateResult = await getUpdateDoc(updateId);
  const updateData = updateResult.data;
  hasUpdateAccess(updateData, currentUserId);

  // Create the comment
  const commentData = {
    [CommentFields.CREATED_BY]: currentUserId,
    [CommentFields.CONTENT]: req.validated_params.content,
    [CommentFields.CREATED_AT]: Timestamp.now(),
    [CommentFields.UPDATED_AT]: Timestamp.now(),
  };

  // Create comment and update comment count in a batch
  const batch = db.batch();
  const commentRef = updateResult.ref.collection(Collections.COMMENTS).doc();
  batch.set(commentRef, commentData);
  batch.update(updateResult.ref, {
    comment_count: (updateData.comment_count || 0) + 1,
  });

  await batch.commit();

  // Get the created comment
  const commentDoc = await commentRef.get();
  const commentDocData = commentDoc.data() || {};

  // Get the creator's profile
  const { data: profileData } = await getProfileDoc(currentUserId);

  const comment = formatComment(commentRef.id, commentDocData, currentUserId);
  comment.username = profileData[ProfileFields.USERNAME] || '';
  comment.name = profileData[ProfileFields.NAME] || '';
  comment.avatar = profileData[ProfileFields.AVATAR] || '';

  // Create analytics event with the updated comment count
  const event: CommentEventParams = {
    comment_length: req.validated_params.content.length,
    comment_count: (updateData.comment_count || 0) + 1,
    reaction_count: updateData.reaction_count || 0,
  };

  return {
    data: comment,
    status: 201,
    analytics: {
      event: EventName.COMMENT_CREATED,
      userId: currentUserId,
      params: event,
    },
  };
};
