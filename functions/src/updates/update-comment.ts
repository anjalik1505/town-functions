import { Request } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { ApiResponse, CommentEventParams, EventName } from "../models/analytics-events";
import { CommentFields, ProfileFields } from "../models/constants";
import { Comment } from "../models/data-models";
import { formatComment, getCommentDoc } from "../utils/comment-utils";
import { ForbiddenError } from "../utils/errors";
import { getLogger } from "../utils/logging-utils";
import { getProfileDoc } from "../utils/profile-utils";

const logger = getLogger(__filename);

/**
 * Updates an existing comment on an update.
 *
 * This function:
 * 1. Verifies the user is the comment creator
 * 2. Updates the comment content
 * 3. Returns the updated comment with profile data
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

  // Get the update document to check if it exists
  const commentResult = await getCommentDoc(updateId, commentId);
  const commentData = commentResult.data;

  // Check if user is the comment creator
  if (commentData[CommentFields.CREATED_BY] !== currentUserId) {
    logger.warn(`User ${currentUserId} attempted to update comment ${commentId} created by ${commentData[CommentFields.CREATED_BY]}`);
    throw new ForbiddenError("You can only update your own comments");
  }

  // Update the comment
  const updatedData = {
    [CommentFields.CONTENT]: req.validated_params.content,
    [CommentFields.UPDATED_AT]: Timestamp.now()
  };

  await commentResult.ref.update(updatedData);

  // Get the updated comment
  const updatedCommentDoc = await commentResult.ref.get();
  const updatedCommentData = updatedCommentDoc.data() || {};

  // Get the creator's profile
  const {data: profileData} = await getProfileDoc(currentUserId);

  const comment = formatComment(commentResult.ref.id, updatedCommentData, currentUserId);
  comment.username = profileData[ProfileFields.USERNAME] || "";
  comment.name = profileData[ProfileFields.NAME] || "";
  comment.avatar = profileData[ProfileFields.AVATAR] || "";

  // Create analytics event
  const event: CommentEventParams = {
    comment_length: req.validated_params.content.length,
    comment_count: commentData.comment_count || 0,
    reaction_count: commentData.reaction_count || 0
  };

  return {
    data: comment,
    status: 200,
    analytics: {
      event: EventName.COMMENT_UPDATED,
      userId: currentUserId,
      params: event
    }
  };
}; 