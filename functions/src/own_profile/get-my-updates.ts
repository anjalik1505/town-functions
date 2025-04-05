import { Request, Response } from "express";
import { getFirestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { Collections, FeedFields, QueryOperators } from "../models/constants";
import { Update, UpdatesResponse } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { applyPagination, generateNextCursor, processQueryStream } from "../utils/pagination-utils";
import { fetchUpdatesReactions } from "../utils/reaction-utils";
import { formatTimestamp } from "../utils/timestamp-utils";

const logger = getLogger(__filename);

/**
 * Retrieves the current user's updates in a paginated format.
 * Uses the same approach as get-my-feeds.ts but filters for updates created by the current user.
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Pagination parameters containing:
 *                - limit: Maximum number of updates to return (default: 20, min: 1, max: 100)
 *                - after_cursor: Cursor for pagination (base64 encoded document path)
 * @param res - The Express response object
 * 
 * @returns An UpdatesResponse containing:
 * - A list of updates belonging to the current user
 * - A next_cursor for pagination (if more results are available)
 */
export const getUpdates = async (req: Request, res: Response): Promise<void> => {
    const currentUserId = req.userId;
    logger.info(`Retrieving updates for user: ${currentUserId}`);

    const db = getFirestore();

    // Get pagination parameters from the validated request
    const validatedParams = req.validated_params;
    const limit = validatedParams?.limit || 20;
    const afterCursor = validatedParams?.after_cursor;

    logger.info(
        `Pagination parameters - limit: ${limit}, after_cursor: ${afterCursor}`
    );

    // Get the user's profile first to verify existence
    const userRef = db.collection(Collections.PROFILES).doc(currentUserId);
    const userDoc = await userRef.get();

    // Return empty response if user profile doesn't exist
    if (!userDoc.exists) {
        logger.warn(`User profile not found for user: ${currentUserId}`);
        res.json({ updates: [], next_cursor: null });
    }

    // Initialize the feed query
    let feedQuery = db
        .collection(Collections.USER_FEEDS)
        .doc(currentUserId)
        .collection(Collections.FEED)
        .where(FeedFields.CREATED_BY, QueryOperators.EQUALS, currentUserId)
        .orderBy(FeedFields.CREATED_AT, QueryOperators.DESC);

    // Apply cursor-based pagination - errors will be automatically caught by Express
    const paginatedQuery = await applyPagination(feedQuery, afterCursor, limit);

    // Process feed items using streaming
    const { items: feedDocs, lastDoc } = await processQueryStream<QueryDocumentSnapshot>(paginatedQuery, doc => doc, limit);

    if (feedDocs.length === 0) {
        logger.info(`No updates found for user ${currentUserId}`);
        res.json({ updates: [], next_cursor: null });
    }

    // Get all update IDs from feed items
    const updateIds = feedDocs.map(doc => doc.data()[FeedFields.UPDATE_ID]);

    // Fetch all updates in parallel
    const updatePromises = updateIds.map(updateId =>
        db.collection(Collections.UPDATES).doc(updateId).get()
    );
    const updateSnapshots = await Promise.all(updatePromises);

    // Create a map of update data for easy lookup
    const updateMap = new Map(
        updateSnapshots
            .filter(doc => doc.exists)
            .map(doc => [doc.id, doc.data()])
    );

    // Fetch reactions for all updates
    const updateReactionsMap = await fetchUpdatesReactions(updateIds);

    // Process feed items and create updates
    const updates: Update[] = feedDocs
        .map(feedItem => {
            const feedData = feedItem.data();
            const updateId = feedData[FeedFields.UPDATE_ID];
            const updateData = updateMap.get(updateId);

            if (!updateData) {
                logger.warn(`Missing update data for feed item ${feedItem.id}`);
                return null;
            }

            const update: Update = {
                update_id: updateId,
                created_by: currentUserId,
                content: updateData.content || "",
                group_ids: updateData.group_ids || [],
                friend_ids: updateData.friend_ids || [],
                sentiment: updateData.sentiment || "",
                created_at: formatTimestamp(updateData.created_at),
                comment_count: updateData.comment_count || 0,
                reaction_count: updateData.reaction_count || 0,
                reactions: updateReactionsMap.get(updateId) || []
            };

            return update;
        })
        .filter((update): update is Update => update !== null);

    // Set up pagination for the next request
    const nextCursor = generateNextCursor(lastDoc, feedDocs.length, limit);

    logger.info(`Retrieved ${updates.length} updates for user ${currentUserId}`);
    const response: UpdatesResponse = { updates, next_cursor: nextCursor };
    res.json(response);
}; 