import { Request, Response } from "express";
import { Timestamp } from "firebase-admin/firestore";
import { CommentFields, ProfileFields } from "../models/constants";
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
 * @param res - The Express response object
 * 
 * @returns 200 OK with Comment object containing:
 * - comment_id: The ID of the updated comment
 * - created_by: The ID of the user who created the comment
 * - content: The updated comment text
 * - created_at: ISO timestamp of creation
 * - updated_at: ISO timestamp of last update
 * - username: The username of the comment creator
 * - name: The display name of the comment creator
 * - avatar: The avatar URL of the comment creator
 * 
 * @throws 400: Invalid request parameters
 * @throws 403: You can only update your own comments
 * @throws 404: Update not found
 * @throws 404: Comment not found
 */
export const updateComment = async (req: Request, res: Response): Promise<void> => {
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
    const { data: profileData } = await getProfileDoc(currentUserId);

    const comment = formatComment(commentResult.ref.id, updatedCommentData, currentUserId);
    comment.username = profileData[ProfileFields.USERNAME] || "";
    comment.name = profileData[ProfileFields.NAME] || "";
    comment.avatar = profileData[ProfileFields.AVATAR] || "";

    res.status(200).json(comment);
}; 