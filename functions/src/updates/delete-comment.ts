import { Request, Response } from "express";
import { getFirestore } from "firebase-admin/firestore";
import { Collections, CommentFields } from "../models/constants";
import { getLogger } from "../utils/logging-utils";

const logger = getLogger(__filename);

/**
 * Deletes a comment from an update.
 * 
 * This function:
 * 1. Verifies the user is the comment creator
 * 2. Deletes the comment document
 * 3. Updates the comment count on the update
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Route parameters containing:
 *                - update_id: The ID of the update
 *                - comment_id: The ID of the comment to delete
 * @param res - The Express response object
 * 
 * @returns A success message
 * 
 * @throws 404: Update or comment not found
 * @throws 403: User is not the comment creator
 */
export const deleteComment = async (req: Request, res: Response): Promise<void> => {
    const updateId = req.params.update_id;
    const commentId = req.params.comment_id;
    const currentUserId = req.userId;
    logger.info(`Deleting comment ${commentId} from update: ${updateId}`);

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
        logger.warn(`User ${currentUserId} attempted to delete comment ${commentId} created by ${commentData[CommentFields.CREATED_BY]}`);
        res.status(403).json({
            code: 403,
            name: "Forbidden",
            description: "You can only delete your own comments"
        });
        return;
    }

    // Delete comment and update comment count in a batch
    const batch = db.batch();
    batch.delete(commentRef);
    batch.update(updateRef, {
        comment_count: Math.max(0, (updateDoc.data()?.comment_count || 0) - 1)
    });

    await batch.commit();

    res.status(204).send();
}; 