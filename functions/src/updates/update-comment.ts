import { Request, Response } from "express";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Collections, CommentFields, ProfileFields } from "../models/constants";
import { Comment } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { formatTimestamp } from "../utils/timestamp-utils";

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
 * @returns The updated comment with profile data
 * 
 * @throws 404: Update or comment not found
 * @throws 403: User is not the comment creator
 */
export const updateComment = async (req: Request, res: Response): Promise<void> => {
    const updateId = req.params.update_id;
    const commentId = req.params.comment_id;
    const currentUserId = req.userId;
    logger.info(`Updating comment ${commentId} on update: ${updateId}`);

    const db = getFirestore();

    // Get the update document to check if it exists
    const updateRef = db.collection(Collections.UPDATES).doc(updateId);
    const updateDoc = await updateRef.get();

    if (!updateDoc.exists) {
        logger.warn(`Update not found: ${updateId}`);
        res.status(404).json({
            code: 404,
            name: "Not Found",
            description: "Update not found"
        });
        return;
    }

    // Get the comment document
    const commentRef = updateRef.collection(Collections.COMMENTS).doc(commentId);
    const commentDoc = await commentRef.get();

    if (!commentDoc.exists) {
        logger.warn(`Comment not found: ${commentId}`);
        res.status(404).json({
            code: 404,
            name: "Not Found",
            description: "Comment not found"
        });
        return;
    }

    const commentData = commentDoc.data() || {};

    // Check if user is the comment creator
    if (commentData[CommentFields.CREATED_BY] !== currentUserId) {
        logger.warn(`User ${currentUserId} attempted to update comment ${commentId} created by ${commentData[CommentFields.CREATED_BY]}`);
        res.status(403).json({
            code: 403,
            name: "Forbidden",
            description: "You can only update your own comments"
        });
        return;
    }

    // Update the comment
    const updatedData = {
        [CommentFields.CONTENT]: req.validated_params.content,
        [CommentFields.UPDATED_AT]: Timestamp.now()
    };

    await commentRef.update(updatedData);

    // Get the updated comment
    const updatedCommentDoc = await commentRef.get();
    const updatedCommentData = updatedCommentDoc.data() || {};

    // Get the creator's profile
    const profileDoc = await db.collection(Collections.PROFILES).doc(currentUserId).get();
    const profileData = profileDoc.data() || {};

    const comment: Comment = {
        comment_id: commentRef.id,
        created_by: currentUserId,
        content: updatedCommentData[CommentFields.CONTENT] || "",
        created_at: formatTimestamp(updatedCommentData[CommentFields.CREATED_AT]),
        updated_at: formatTimestamp(updatedCommentData[CommentFields.UPDATED_AT]),
        username: profileData[ProfileFields.USERNAME] || "",
        name: profileData[ProfileFields.NAME] || "",
        avatar: profileData[ProfileFields.AVATAR] || ""
    };

    res.status(200).json(comment);
}; 