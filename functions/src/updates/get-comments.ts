import { NextFunction, Request, Response } from "express";
import { getFirestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { Collections, CommentFields, QueryOperators, UpdateFields } from "../models/constants";
import { Comment, CommentsResponse } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { applyPagination, generateNextCursor, processQueryStream } from "../utils/pagination-utils";
import { enrichWithProfile, fetchUsersProfiles } from "../utils/profile-utils";
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
 *                - after_cursor: Cursor for pagination (base64 encoded document path)
 *              - params: Route parameters containing:
 *                - update_id: The ID of the update to get comments for
 * @param res - The Express response object
 * @param next - The Express next function for error handling
 * 
 * @returns 200 OK with CommentsResponse containing:
 * - A list of comments with profile data
 * - A next_cursor for pagination (if more results are available)
 * 
 * @throws 400: Invalid query parameters
 * @throws 403: You don't have access to this update
 * @throws 404: Update not found
 */
export const getComments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const updateId = req.params.update_id;
    const currentUserId = req.userId;
    logger.info(`Retrieving comments for update: ${updateId}`);

    const db = getFirestore();

    // Get pagination parameters
    const validatedParams = req.validated_params;
    const limit = validatedParams?.limit || 20;
    const afterCursor = validatedParams?.after_cursor;

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
        .orderBy(CommentFields.CREATED_AT, QueryOperators.DESC);

    // Apply cursor-based pagination - errors will be automatically caught by Express
    const paginatedQuery = await applyPagination(query, afterCursor, limit);

    // Process comments using streaming
    const { items: commentDocs, lastDoc } = await processQueryStream<QueryDocumentSnapshot>(paginatedQuery, doc => doc, limit);

    // Process comments and collect user IDs
    const comments: Comment[] = [];
    const uniqueUserIds = new Set<string>();

    for (const commentDoc of commentDocs) {
        const docData = commentDoc.data();
        const createdBy = docData[CommentFields.CREATED_BY] || "";

        const comment: Comment = {
            comment_id: commentDoc.id,
            created_by: createdBy,
            content: docData[CommentFields.CONTENT] || "",
            created_at: docData[CommentFields.CREATED_AT] ? formatTimestamp(docData[CommentFields.CREATED_AT]) : "",
            updated_at: docData[CommentFields.UPDATED_AT] ? formatTimestamp(docData[CommentFields.UPDATED_AT]) : "",
            username: "",  // Will be populated from profile
            name: "",     // Will be populated from profile
            avatar: ""    // Will be populated from profile
        };

        comments.push(comment);
        uniqueUserIds.add(createdBy);
    }

    // Get profiles for all users who commented
    const profiles = await fetchUsersProfiles(Array.from(uniqueUserIds));

    // Enrich comments with profile data
    const enrichedComments = comments.map(comment => {
        const profile = profiles.get(comment.created_by);
        if (!profile) {
            logger.warn(`Missing profile data for user ${comment.created_by}`);
        }
        return enrichWithProfile(comment, profile || null);
    });

    // Set up pagination for the next request
    const nextCursor = generateNextCursor(lastDoc, enrichedComments.length, limit);

    const response: CommentsResponse = {
        comments: enrichedComments.slice(0, limit),
        next_cursor: nextCursor
    };

    res.status(200).json(response);
}; 