import { Request, Response } from "express";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Collections, CommentFields, ProfileFields, UpdateFields } from "../models/constants";
import { Comment } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { formatTimestamp } from "../utils/timestamp-utils";
import { createFriendVisibilityIdentifier } from "../utils/visibility-utils";

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
 * @returns The created comment with profile data
 * 
 * @throws 404: Update not found
 * @throws 403: User doesn't have access to this update
 */
export const createComment = async (req: Request, res: Response): Promise<void> => {
    const updateId = req.params.update_id;
    const currentUserId = req.userId;
    logger.info(`Creating comment on update: ${updateId}`);

    const db = getFirestore();

    // Get the update document to check access
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

    const updateData = updateDoc.data() || {};
    const visibleTo = updateData[UpdateFields.VISIBLE_TO] || [];
    const friendVisibility = createFriendVisibilityIdentifier(currentUserId);

    // Check if user has access to this update
    if (!visibleTo.includes(friendVisibility)) {
        logger.warn(`User ${currentUserId} attempted to comment on update ${updateId} without access`);
        res.status(403).json({
            code: 403,
            name: "Forbidden",
            description: "You don't have access to this update"
        });
        return;
    }

    // Create the comment
    const commentData = {
        [CommentFields.CREATED_BY]: currentUserId,
        [CommentFields.CONTENT]: req.validated_params.content,
        [CommentFields.CREATED_AT]: Timestamp.now(),
        [CommentFields.UPDATED_AT]: Timestamp.now()
    };

    // Create comment and update comment count in a batch
    const batch = db.batch();
    const commentRef = updateRef.collection(Collections.COMMENTS).doc();
    batch.set(commentRef, commentData);
    batch.update(updateRef, {
        comment_count: (updateData.comment_count || 0) + 1
    });

    await batch.commit();

    // Get the created comment
    const commentDoc = await commentRef.get();
    const commentDocData = commentDoc.data() || {};

    // Get the creator's profile
    const profileDoc = await db.collection(Collections.PROFILES).doc(currentUserId).get();
    const profileData = profileDoc.data() || {};

    const comment: Comment = {
        comment_id: commentRef.id,
        created_by: currentUserId,
        content: commentDocData[CommentFields.CONTENT] || "",
        created_at: formatTimestamp(commentDocData[CommentFields.CREATED_AT]),
        updated_at: formatTimestamp(commentDocData[CommentFields.UPDATED_AT]),
        username: profileData[ProfileFields.USERNAME] || "",
        name: profileData[ProfileFields.NAME] || "",
        avatar: profileData[ProfileFields.AVATAR] || ""
    };

    res.status(201).json(comment);
}; 