import { Request } from 'express';
import { Timestamp, UpdateData } from 'firebase-admin/firestore';
import { ApiResponse, CommentEventParams, EventName } from '../models/analytics-events.js';
import { CommentDoc } from '../models/firestore/comment-doc.js';
import { Comment, UpdateCommentPayload } from '../models/data-models.js';
import { formatComment, getCommentDoc } from '../utils/comment-utils.js';
import { BadRequestError, ForbiddenError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Updates an existing comment on an update.
 *
 * This function:
 * 1. Verifies the user is comment creator
 * 2. Updates comment content only
 * 3. Returns the updated comment with existing profile data
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Comment data containing:
 *                - content: The updated comment text
 *              - params: Route parameters containing:
 *                - update_id: The ID of the update
 *                - comment_id: The ID of the comment to update
 *
 * @returns An ApiResponse containing the updated comment and analytics
 *
 * @throws 400: Invalid request parameters
 * @throws 403: You can only update your own comments
 * @throws 404: Update not found
 * @throws 404: Comment not found
 */
export const updateComment = async (req: Request): Promise<ApiResponse<Comment>> => {
  const updateId = req.params.update_id;
  const commentId = req.params.comment_id;
  const currentUserId = req.userId;
  logger.info(`Updating comment ${commentId} on update: ${updateId}`);

  if (!updateId) {
    throw new BadRequestError('Update ID is required');
  }

  if (!commentId) {
    throw new BadRequestError('Comment ID is required');
  }

  const validatedPayload = req.validated_params as UpdateCommentPayload;

  // Get the update document to check if it exists
  const commentResult = await getCommentDoc(updateId, commentId);
  const commentData = commentResult.data;

  // Check if the user is the comment creator
  if (commentData.created_by !== currentUserId) {
    logger.warn(`User ${currentUserId} attempted to update comment ${commentId} created by ${commentData.created_by}`);
    throw new ForbiddenError('You can only update your own comments');
  }

  // Update only the comment content
  const updatedData: UpdateData<CommentDoc> = {
    content: validatedPayload.content,
    updated_at: Timestamp.now(),
  };

  await commentResult.ref.update(updatedData);

  // Get the updated comment
  const updatedCommentDoc = await commentResult.ref.get();
  const updatedCommentData = updatedCommentDoc.data();

  if (!updatedCommentData) {
    throw new Error('Failed to retrieve updated comment');
  }

  const comment = formatComment(commentResult.ref.id, updatedCommentData, currentUserId);
  // Use the existing denormalized profile data from the comment document
  const denormalizedProfile = updatedCommentData.commenter_profile;
  comment.username = denormalizedProfile.username || '';
  comment.name = denormalizedProfile.name || '';
  comment.avatar = denormalizedProfile.avatar || '';

  // Create analytics event
  const event: CommentEventParams = {
    comment_length: validatedPayload.content.length,
    comment_count: 0, // This data is on the update, not the comment
    reaction_count: 0, // This data is on the update, not the comment
  };

  return {
    data: comment,
    status: 200,
    analytics: {
      event: EventName.COMMENT_UPDATED,
      userId: currentUserId,
      params: event,
    },
  };
};
