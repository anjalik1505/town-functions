import { Request } from "express";
import { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { ApiResponse, CommentViewEventParams, EventName } from "../models/analytics-events";
import { Collections, CommentFields, QueryOperators } from "../models/constants";
import { CommentsResponse } from "../models/data-models";
import { processEnrichedComments } from "../utils/comment-utils";
import { getLogger } from "../utils/logging-utils";
import { applyPagination, generateNextCursor, processQueryStream } from "../utils/pagination-utils";
import { fetchUsersProfiles } from "../utils/profile-utils";
import { getUpdateDoc, hasUpdateAccess } from "../utils/update-utils";

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
 * 
 * @returns An ApiResponse containing the comments and analytics data
 * 
 * @throws 400: Invalid query parameters
 * @throws 403: You don't have access to this update
 * @throws 404: Update not found
 */
export const getComments = async (req: Request): Promise<ApiResponse<CommentsResponse>> => {
    const updateId = req.params.update_id;
    const currentUserId = req.userId;
    logger.info(`Retrieving comments for update: ${updateId}`);

    // Get pagination parameters
    const validatedParams = req.validated_params;
    const limit = validatedParams?.limit || 20;
    const afterCursor = validatedParams?.after_cursor;

    // Get the update document to check access
    const updateResult = await getUpdateDoc(updateId);
    hasUpdateAccess(updateResult.data, currentUserId);

    // Build the query
    let query = updateResult.ref.collection(Collections.COMMENTS)
        .orderBy(CommentFields.CREATED_AT, QueryOperators.DESC);

    // Apply cursor-based pagination - errors will be automatically caught by Express
    const paginatedQuery = await applyPagination(query, afterCursor, limit);

    // Process comments using streaming
    const { items: commentDocs, lastDoc } = await processQueryStream<QueryDocumentSnapshot>(paginatedQuery, doc => doc, limit);

    // Collect user IDs from comments
    const uniqueUserIds = new Set<string>();
    commentDocs.forEach(doc => {
        const createdBy = doc.data()[CommentFields.CREATED_BY] || "";
        if (createdBy) {
            uniqueUserIds.add(createdBy);
        }
    });

    // Get profiles for all users who commented
    const profiles = await fetchUsersProfiles(Array.from(uniqueUserIds));

    // Process comments and create enriched comment objects
    const enrichedComments = processEnrichedComments(commentDocs, profiles);

    // Set up pagination for the next request
    const nextCursor = generateNextCursor(lastDoc, enrichedComments.length, limit);

    const response: CommentsResponse = {
        comments: enrichedComments.slice(0, limit),
        next_cursor: nextCursor
    };

    // Create analytics event
    const event: CommentViewEventParams = {
        comment_count: updateResult.data.comment_count || 0,
        reaction_count: updateResult.data.reaction_count || 0,
        unique_creators: uniqueUserIds.size
    };

    return {
        data: response,
        status: 200,
        analytics: {
            event: EventName.COMMENTS_VIEWED,
            userId: currentUserId,
            params: event
        }
    };
}; 