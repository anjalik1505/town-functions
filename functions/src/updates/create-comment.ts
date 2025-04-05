import { Request, Response } from "express";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Collections, CommentFields, ProfileFields } from "../models/constants";
import { formatComment } from "../utils/comment-utils";
import { getLogger } from "../utils/logging-utils";
import { getProfileDoc } from "../utils/profile-utils";
import { getUpdateDoc, hasUpdateAccess } from "../utils/update-utils";

const logger = getLogger(__filename);

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
 * @param res - The Express response object
 * 
 * @returns 201 Created with Comment object containing:
 * - comment_id: The ID of the created comment
 * - created_by: The ID of the user who created the comment
 * - content: The comment text
 * - created_at: ISO timestamp of creation
 * - updated_at: ISO timestamp of last update
 * - username: The username of the comment creator
 * - name: The display name of the comment creator
 * - avatar: The avatar URL of the comment creator
 * 
 * @throws 400: Invalid request parameters
 * @throws 403: You don't have access to this update
 * @throws 404: Update not found
 */
export const createComment = async (req: Request, res: Response): Promise<void> => {
    const updateId = req.params.update_id;
    const currentUserId = req.userId;
    logger.info(`Creating comment on update: ${updateId}`);

    const db = getFirestore();

    // Get the update document to check access
    const updateResult = await getUpdateDoc(updateId);
    const updateData = updateResult.data;
    hasUpdateAccess(updateData, currentUserId);

    // Create the comment
    const commentData = {
        [CommentFields.CREATED_BY]: currentUserId,
        [CommentFields.CONTENT]: req.validated_params.content,
        [CommentFields.CREATED_AT]: Timestamp.now(),
        [CommentFields.UPDATED_AT]: Timestamp.now()
    };

    // Create comment and update comment count in a batch
    const batch = db.batch();
    const commentRef = updateResult.ref.collection(Collections.COMMENTS).doc();
    batch.set(commentRef, commentData);
    batch.update(updateResult.ref, {
        comment_count: (updateData.comment_count || 0) + 1
    });

    await batch.commit();

    // Get the created comment
    const commentDoc = await commentRef.get();
    const commentDocData = commentDoc.data() || {};

    // Get the creator's profile
    const { data: profileData } = await getProfileDoc(currentUserId);

    const comment = formatComment(commentRef.id, commentDocData, currentUserId);
    comment.username = profileData[ProfileFields.USERNAME] || "";
    comment.name = profileData[ProfileFields.NAME] || "";
    comment.avatar = profileData[ProfileFields.AVATAR] || "";

    res.status(201).json(comment);
}; 