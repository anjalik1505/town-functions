import { Request, Response } from "express";
import { getFirestore, QueryDocumentSnapshot, Timestamp } from "firebase-admin/firestore";
import { Collections, CommentFields, ProfileFields, UpdateFields } from "../models/constants";
import { Comment, CommentsResponse } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { formatTimestamp } from "../utils/timestamp-utils";
import { createFriendVisibilityIdentifier } from "../utils/visibility-utils";

const logger = getLogger(__filename);

/**
 * Retrieves paginated comments for an update.
 * 
 * This function:
 * 1. Verifies the user has access to the update using visibility identifiers
 * 2. Fetches paginated comments
 * 3. Enriches comments with profile data
 * 4. Returns comments in descending order by creation time
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Pagination parameters containing:
 *                - limit: Maximum number of comments to return (default: 20, min: 1, max: 100)
 *                - after_timestamp: Timestamp for pagination in ISO format
 *              - params: Route parameters containing:
 *                - update_id: The ID of the update to get comments for
 * @param res - The Express response object
 * 
 * @returns 200 OK with CommentsResponse containing:
 * - A list of comments with profile data
 * - A next_timestamp for pagination (if more results are available)
 * 
 * @throws 400: Invalid query parameters
 * @throws 403: You don't have access to this update
 * @throws 404: Update not found
 */
export const getComments = async (req: Request, res: Response): Promise<void> => {
    const updateId = req.params.update_id;
    const currentUserId = req.userId;
    logger.info(`Retrieving comments for update: ${updateId}`);

    const db = getFirestore();

    // Get pagination parameters
    const validatedParams = req.validated_params;
    const limit = validatedParams?.limit || 20;
    const afterTimestamp = validatedParams?.after_timestamp;

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
        logger.warn(`User ${currentUserId} attempted to view comments on update ${updateId} without access`);
        res.status(403).json({
            code: 403,
            name: "Forbidden",
            description: "You don't have access to this update"
        });
        return;
    }

    // Build the query
    let query = updateRef.collection(Collections.COMMENTS)
        .orderBy(CommentFields.CREATED_AT, "desc");

    // Apply pagination
    if (afterTimestamp) {
        query = query.startAfter({ [CommentFields.CREATED_AT]: afterTimestamp });
    }

    // Apply limit
    query = query.limit(limit);

    // Get comments
    const comments: Comment[] = [];
    const uniqueUserIds = new Set<string>();

    for await (const doc of query.stream()) {
        const commentDoc = doc as unknown as QueryDocumentSnapshot;
        const docData = commentDoc.data();
        const createdAt = docData[CommentFields.CREATED_AT] as Timestamp;

        const comment: Comment = {
            comment_id: commentDoc.id,
            created_by: docData[CommentFields.CREATED_BY] || "",
            content: docData[CommentFields.CONTENT] || "",
            created_at: createdAt ? formatTimestamp(createdAt) : "",
            updated_at: docData[CommentFields.UPDATED_AT] ? formatTimestamp(docData[CommentFields.UPDATED_AT]) : "",
            username: "",  // Will be populated from profile
            name: "",     // Will be populated from profile
            avatar: ""    // Will be populated from profile
        };

        comments.push(comment);
        uniqueUserIds.add(comment.created_by);
    }

    // Get profiles for all users who commented
    const profiles = new Map<string, { username: string; name: string; avatar: string }>();
    const profilePromises = Array.from(uniqueUserIds).map(async (userId) => {
        const profileDoc = await db.collection(Collections.PROFILES).doc(userId).get();
        if (profileDoc.exists) {
            const profileData = profileDoc.data() || {};
            profiles.set(userId, {
                username: profileData[ProfileFields.USERNAME] || "",
                name: profileData[ProfileFields.NAME] || "",
                avatar: profileData[ProfileFields.AVATAR] || ""
            });
        }
    });

    await Promise.all(profilePromises);

    // Enrich comments with profile data
    const enrichedComments = comments.map(comment => {
        const profile = profiles.get(comment.created_by);
        if (!profile) {
            logger.warn(`Missing profile data for user ${comment.created_by}`);
        }
        return {
            ...comment,
            ...profile
        };
    });

    // Set up pagination for the next request
    let nextTimestamp: string | null = null;
    if (enrichedComments.length === limit) {
        const lastComment = enrichedComments[limit - 1];
        nextTimestamp = lastComment.created_at;
    }

    const response: CommentsResponse = {
        comments: enrichedComments.slice(0, limit),
        next_timestamp: nextTimestamp
    };

    res.status(200).json(response);
}; 