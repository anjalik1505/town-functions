import { Request, Response } from "express";
import { getFirestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { Collections, FeedFields, FriendshipFields, QueryOperators, Status } from "../models/constants";
import { Update, UpdatesResponse } from "../models/data-models";
import { createFriendshipId } from "../utils/friendship-utils";
import { getLogger } from "../utils/logging-utils";
import { applyPagination, generateNextCursor, processQueryStream } from "../utils/pagination-utils";
import { fetchUpdatesReactions } from "../utils/reaction-utils";
import { formatTimestamp } from "../utils/timestamp-utils";

const logger = getLogger(__filename);

/**
 * Retrieves paginated updates for a specific user.
 * Uses the same approach as get-my-feeds.ts but filters for updates from the target user.
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Pagination parameters containing:
 *                - limit: Maximum number of updates to return
 *                - after_cursor: Cursor for pagination (base64 encoded document path)
 *              - params: Route parameters containing:
 *                - target_user_id: The ID of the user whose updates are being requested
 * @param res - The Express response object
 * 
 * @returns An UpdatesResponse containing:
 * - A list of updates created by the specified user
 * - A next_cursor for pagination (if more results are available)
 * 
 * @throws 400: Use /me/updates endpoint to view your own updates
 * @throws 404: Profile not found
 * @throws 403: You must be friends with this user to view their updates
 */
export const getUserUpdates = async (req: Request, res: Response): Promise<void> => {
    const currentUserId = req.userId;
    const targetUserId = req.params.target_user_id;

    logger.info(
        `Retrieving updates for user ${targetUserId} requested by ${currentUserId}`
    );

    const db = getFirestore();

    // Redirect users to the appropriate endpoint for their own updates
    if (currentUserId === targetUserId) {
        logger.warn(
            `User ${currentUserId} attempted to view their own updates through /user endpoint`
        );
        res.status(400).json({
            code: 400,
            name: "Bad Request",
            description: "Use /me/updates endpoint to view your own updates"
        });
    }

    // Get pagination parameters from the validated request
    const validatedParams = req.validated_params;
    const limit = validatedParams?.limit || 20;
    const afterCursor = validatedParams?.after_cursor;

    logger.info(
        `Pagination parameters - limit: ${limit}, after_cursor: ${afterCursor}`
    );

    // Get the target user's profile
    const targetUserProfileRef = db.collection(Collections.PROFILES).doc(targetUserId);
    const targetUserProfileDoc = await targetUserProfileRef.get();

    // Check if the target profile exists
    if (!targetUserProfileDoc.exists) {
        logger.warn(`Profile not found for user ${targetUserId}`);
        res.status(404).json({
            code: 404,
            name: "Not Found",
            description: "Profile not found"
        });
    }

    // Get the current user's profile
    const currentUserProfileRef = db.collection(Collections.PROFILES).doc(currentUserId);
    const currentUserProfileDoc = await currentUserProfileRef.get();

    if (!currentUserProfileDoc.exists) {
        logger.warn(`Profile not found for current user ${currentUserId}`);
        res.status(404).json({
            code: 404,
            name: "Not Found",
            description: "Profile not found"
        });
    }

    // Check if users are friends using the unified friendships collection
    const friendshipId = createFriendshipId(currentUserId, targetUserId);
    const friendshipRef = db.collection(Collections.FRIENDSHIPS).doc(friendshipId);
    const friendshipDoc = await friendshipRef.get();

    // If they are not friends, return an error
    if (
        !friendshipDoc.exists ||
        friendshipDoc.data()?.[FriendshipFields.STATUS] !== Status.ACCEPTED
    ) {
        logger.warn(
            `User ${currentUserId} attempted to view updates of non-friend ${targetUserId}`
        );
        res.status(403).json({
            code: 403,
            name: "Forbidden",
            description: "You must be friends with this user to view their updates"
        });
    }

    logger.info(`Friendship verified between ${currentUserId} and ${targetUserId}`);

    // Initialize the feed query
    let feedQuery = db
        .collection(Collections.USER_FEEDS)
        .doc(currentUserId)
        .collection(Collections.FEED)
        .where(FeedFields.CREATED_BY, QueryOperators.EQUALS, targetUserId)
        .orderBy(FeedFields.CREATED_AT, QueryOperators.DESC);

    // Apply cursor-based pagination - errors will be automatically caught by Express
    const paginatedQuery = await applyPagination(feedQuery, afterCursor, limit);

    // Process feed items using streaming
    const { items: feedDocs, lastDoc } = await processQueryStream<QueryDocumentSnapshot>(paginatedQuery, doc => doc, limit);

    if (feedDocs.length === 0) {
        logger.info(`No updates found for user ${targetUserId}`);
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
                created_by: targetUserId,
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

    logger.info(`Retrieved ${updates.length} updates for user ${targetUserId}`);
    const response: UpdatesResponse = { updates, next_cursor: nextCursor };
    res.json(response);
}; 