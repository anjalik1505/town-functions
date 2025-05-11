import { Request } from 'express';
import { DocumentData, getFirestore, UpdateData, } from 'firebase-admin/firestore';
import { ApiResponse, CommentEventParams, EventName, } from '../models/analytics-events.js';
import { CommentFields } from '../models/constants.js';
import { getCommentDoc } from '../utils/comment-utils.js';
import { BadRequestError, ForbiddenError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { getUpdateDoc } from '../utils/update-utils.js';

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Deletes a comment from an update.
 *
 * This function:
 * 1. Verifies the user is comment creator
 * 2. Deletes comment document
 * 3. Updates the comment count on the update
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Route parameters containing:
 *                - update_id: The ID of the update
 *                - comment_id: The ID of the comment to delete
 *
 * @returns An ApiResponse containing analytics data
 *
 * @throws 404: Update not found
 * @throws 404: Comment not found
 * @throws 403: You can only delete your own comments
 */
export const deleteComment = async (
  req: Request,
): Promise<ApiResponse<null>> => {
  const updateId = req.params.update_id;
  const commentId = req.params.comment_id;
  const currentUserId = req.userId;
  logger.info(`Deleting comment ${commentId} from update: ${updateId}`);

  const db = getFirestore();

  if (!updateId) {
    throw new BadRequestError('Update ID is required');
  }

  if (!commentId) {
    throw new BadRequestError('Comment ID is required');
  }

  // Get the update document to check if it exists
  const updateResult = await getUpdateDoc(updateId);
  const commentResult = await getCommentDoc(updateId, commentId);
  const commentData = commentResult.data;

  // Check if the user is the comment creator
  if (commentData[CommentFields.CREATED_BY] !== currentUserId) {
    logger.warn(
      `User ${currentUserId} attempted to delete comment ${commentId} created by ${commentData[CommentFields.CREATED_BY]}`,
    );
    throw new ForbiddenError('You can only delete your own comments');
  }

  // Delete comment and update the comment count in a batch
  const batch = db.batch();
  batch.delete(commentResult.ref);

  const updateCountData: UpdateData<DocumentData> = {
    comment_count: Math.max(0, (updateResult.data.comment_count || 0) - 1),
  };
  batch.update(updateResult.ref, updateCountData);

  await batch.commit();

  // Create analytics event
  const event: CommentEventParams = {
    comment_length: commentData[CommentFields.CONTENT].length,
    comment_count: Math.max(0, (updateResult.data.comment_count || 0) - 1),
    reaction_count: updateResult.data.reaction_count || 0,
  };

  return {
    data: null,
    status: 204,
    analytics: {
      event: EventName.COMMENT_DELETED,
      userId: currentUserId,
      params: event,
    },
  };
};
