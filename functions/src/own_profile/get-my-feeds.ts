import { NextFunction, Request, Response } from "express";
import { getFirestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { Collections, FeedFields, QueryOperators } from "../models/constants";
import { EnrichedUpdate, FeedResponse } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { applyPagination, generateNextCursor, processQueryStream } from "../utils/pagination-utils";
import { enrichWithProfile, fetchUsersProfiles } from "../utils/profile-utils";
import { fetchUpdatesReactions } from "../utils/reaction-utils";
import { formatTimestamp } from "../utils/timestamp-utils";

const logger = getLogger(__filename);

/**
 * Retrieves the user's feed of updates, paginated using cursor-based pagination.
 * 
 * This function:
 * 1. Queries the user's feed collection directly
 * 2. Uses cursor-based pagination for efficient data loading
 * 3. Fetches the full update content for each feed item
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Pagination parameters containing:
 *                - limit: Maximum number of updates to return (default: 20, min: 1, max: 100)
 *                - after_cursor: Cursor for pagination (Base64 encoded document reference)
 * @param res - The Express response object
 * @param next - The Express next function for error handling
 * 
 * @returns A FeedResponse containing:
 * - A list of enriched updates from the user's feed
 * - A next_cursor for pagination (if more results are available)
 */
export const getFeeds = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const currentUserId = req.userId;
    logger.info(`Retrieving feed for user: ${currentUserId}`);

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
        .orderBy(FeedFields.CREATED_AT, QueryOperators.DESC);

    // Apply cursor-based pagination
    let paginatedQuery;
    try {
        paginatedQuery = await applyPagination(feedQuery, afterCursor, limit);
    } catch (err) {
        next(err);
        return; // Return after error to prevent further execution
    }

    // Process feed items using streaming
    const { items: feedDocs, lastDoc } = await processQueryStream<QueryDocumentSnapshot>(paginatedQuery, doc => doc);

    if (feedDocs.length === 0) {
        logger.info(`No feed items found for user ${currentUserId}`);
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

    // Get unique user IDs from the updates
    const uniqueUserIds = Array.from(new Set(
        updateSnapshots
            .filter(doc => doc.exists)
            .map(doc => doc.data()?.[FeedFields.CREATED_BY])
            .filter(Boolean)
    ));

    // Fetch all user profiles in parallel
    const profiles = await fetchUsersProfiles(uniqueUserIds);

    // Fetch reactions for all updates
    const updateReactionsMap = await fetchUpdatesReactions(updateIds);

    // Process feed items and create enriched updates
    const enrichedUpdates: EnrichedUpdate[] = feedDocs
        .map(feedItem => {
            const feedData = feedItem.data();
            const updateId = feedData[FeedFields.UPDATE_ID];
            const updateData = updateMap.get(updateId);
            const createdBy = feedData[FeedFields.CREATED_BY];

            if (!updateData) {
                logger.warn(`Missing update data for feed item ${feedItem.id}`);
                return null;
            }

            const update: EnrichedUpdate = {
                update_id: updateId,
                created_by: createdBy,
                content: updateData.content || "",
                group_ids: updateData.group_ids || [],
                friend_ids: updateData.friend_ids || [],
                sentiment: updateData.sentiment || "",
                created_at: formatTimestamp(updateData.created_at),
                comment_count: updateData.comment_count || 0,
                reaction_count: updateData.reaction_count || 0,
                reactions: updateReactionsMap.get(updateId) || [],
                username: "",  // Will be populated by enrichWithProfile
                name: "",     // Will be populated by enrichWithProfile
                avatar: ""    // Will be populated by enrichWithProfile
            };

            return enrichWithProfile(update, profiles.get(createdBy) || null);
        })
        .filter((update): update is EnrichedUpdate => update !== null);

    // Set up pagination for the next request
    const nextCursor = generateNextCursor(lastDoc, feedDocs.length, limit);

    logger.info(`Retrieved ${enrichedUpdates.length} updates for user ${currentUserId}`);
    const response: FeedResponse = { updates: enrichedUpdates, next_cursor: nextCursor };
    res.json(response);
}; 