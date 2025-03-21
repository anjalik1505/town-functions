import { Request, Response } from "express";
import { getFirestore, QueryDocumentSnapshot, Timestamp } from "firebase-admin/firestore";
import { Collections, FriendshipFields, ProfileFields, QueryOperators, Status, UpdateFields } from "../models/constants";
import { Update } from "../models/data-models";
import { getLogger } from "../utils/logging_utils";
import { formatTimestamp } from "../utils/timestamp_utils";

const logger = getLogger(__filename);

/**
 * Retrieves paginated updates for a specific user.
 * 
 * This function fetches:
 * 1. Updates created by the target user that has the current user as a friend
 * 2. Updates from groups shared between the current user and target user
 * 
 * The updates are ordered by creation time (newest first) and supports pagination
 * for efficient data loading. The function enforces friendship checks to ensure
 * only friends can view each other's updates.
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Pagination parameters containing:
 *                - limit: Maximum number of updates to return
 *                - after_timestamp: Timestamp for pagination
 *              - params: Route parameters containing:
 *                - target_user_id: The ID of the user whose updates are being requested
 * @param res - The Express response object
 * 
 * @returns An UpdatesResponse containing:
 * - A list of updates created by the specified user and from shared groups
 * - A next_timestamp for pagination (if more results are available)
 * 
 * @throws 400: Use /me/updates endpoint to view your own updates
 * @throws 404: Profile not found
 * @throws 403: You must be friends with this user to view their updates
 */
export const getUserUpdates = async (req: Request, res: Response) => {
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
        return res.status(400).json({
            code: 400,
            name: "Bad Request",
            description: "Use /me/updates endpoint to view your own updates"
        });
    }

    // Get pagination parameters from the validated request
    const validatedParams = req.validated_params;
    const limit = validatedParams?.limit || 20;
    const afterTimestamp = validatedParams?.after_timestamp;

    logger.info(
        `Pagination parameters - limit: ${limit}, after_timestamp: ${afterTimestamp}`
    );

    // Get the target user's profile
    const targetUserProfileRef = db.collection(Collections.PROFILES).doc(targetUserId);
    const targetUserProfileDoc = await targetUserProfileRef.get();

    // Check if the target profile exists
    if (!targetUserProfileDoc.exists) {
        logger.warn(`Profile not found for user ${targetUserId}`);
        return res.status(404).json({
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
        return res.status(404).json({
            code: 404,
            name: "Not Found",
            description: "Profile not found"
        });
    }

    // Get the group IDs for both users to find shared groups
    const targetUserData = targetUserProfileDoc.data() || {};
    const currentUserData = currentUserProfileDoc.data() || {};

    const targetGroupIds = targetUserData[ProfileFields.GROUP_IDS] || [];
    const currentGroupIds = currentUserData[ProfileFields.GROUP_IDS] || [];

    // Find shared groups
    const sharedGroupIds = targetGroupIds.filter((id: string) => currentGroupIds.includes(id));
    logger.info(`Found ${sharedGroupIds.length} shared groups between users`);

    // Check if users are friends using the unified friendships collection
    // Create a consistent ordering of user IDs for the query
    const userIds = [currentUserId, targetUserId].sort();
    const friendshipId = `${userIds[0]}_${userIds[1]}`;

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
        return res.status(403).json({
            code: 403,
            name: "Forbidden",
            description: "You must be friends with this user to view their updates"
        });
    }

    logger.info(`Friendship verified between ${currentUserId} and ${targetUserId}`);

    // Get updates from the target user with pagination to ensure we get enough items
    const userUpdates: Update[] = [];
    let lastDoc: QueryDocumentSnapshot | null = null;
    const batchSize = limit * 2; // Fetch more items than needed to account for filtering

    // Continue fetching until we have enough items or there are no more to fetch
    while (userUpdates.length < limit) {
        // Build the query
        let userQuery = db.collection(Collections.UPDATES)
            .where(UpdateFields.CREATED_BY, QueryOperators.EQUALS, targetUserId)
            .orderBy(UpdateFields.CREATED_AT, "desc");

        // Apply pagination from the last document or after_timestamp
        if (lastDoc) {
            userQuery = userQuery.startAfter(lastDoc);
        } else if (afterTimestamp) {
            userQuery = userQuery.startAfter({ [UpdateFields.CREATED_AT]: afterTimestamp });
        }

        userQuery = userQuery.limit(batchSize);

        // Process updates as they stream in
        let currentLastDoc: QueryDocumentSnapshot | null = null;
        for await (const doc of userQuery.stream()) {
            const updateDoc = doc as unknown as QueryDocumentSnapshot;
            currentLastDoc = updateDoc;
            const docData = updateDoc.data();
            const createdAt = docData[UpdateFields.CREATED_AT] as Timestamp;
            const updateGroupIds = docData[UpdateFields.GROUP_IDS] || [];

            // Convert Firestore datetime to ISO format string for the Update model
            const createdAtIso = createdAt ? formatTimestamp(createdAt) : "";

            // Check if the update is in a shared group or if the current user is a friend
            const isInSharedGroup = updateGroupIds.some((groupId: string) => sharedGroupIds.includes(groupId));
            const friendIds = docData[UpdateFields.FRIEND_IDS] || [];
            const isFriend = friendIds.includes(currentUserId);

            // Only include the update if it's in a shared group or the current user is a friend
            if (isInSharedGroup || isFriend) {
                // Convert Firestore document to Update model
                userUpdates.push({
                    update_id: updateDoc.id,
                    created_by: docData[UpdateFields.CREATED_BY] || "",
                    content: docData[UpdateFields.CONTENT] || "",
                    group_ids: updateGroupIds,
                    friend_ids: friendIds,
                    sentiment: docData[UpdateFields.SENTIMENT] || "",
                    created_at: createdAtIso
                });

                // If we have enough items, break the loop
                if (userUpdates.length >= limit) {
                    break;
                }
            }
        }

        // If no more documents, break the loop
        if (userUpdates.length < limit) {
            break;
        }

        // Keep track of the last document for pagination
        lastDoc = currentLastDoc;
    }

    // Limit to exactly the requested number
    const limitedUpdates = userUpdates.slice(0, limit);

    // Set up pagination for the next request
    let nextTimestamp: string | null = null;
    if (limitedUpdates.length === limit) {
        nextTimestamp = limitedUpdates[limitedUpdates.length - 1].created_at;
        logger.info(`More results available, next_timestamp: ${nextTimestamp}`);
    }

    logger.info(`Retrieved ${limitedUpdates.length} updates for user ${targetUserId}`);
    return res.json({ updates: limitedUpdates, next_timestamp: nextTimestamp });
}; 