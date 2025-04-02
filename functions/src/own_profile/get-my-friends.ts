import { NextFunction, Request, Response } from "express";
import { getFirestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { Collections, FriendshipFields, QueryOperators, Status } from "../models/constants";
import { Friend, FriendsResponse } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { applyPagination, generateNextCursor, processQueryStream } from "../utils/pagination-utils";

const logger = getLogger(__filename);

/**
 * Retrieves the current user's friends and pending friendship requests.
 * 
 * This function fetches all accepted and pending friendships where the current user
 * is in the members array, and returns the friend's information with status.
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Pagination parameters containing:
 *                - limit: Maximum number of friends to return (default: 20, min: 1, max: 100)
 *                - after_cursor: Cursor for pagination (base64 encoded document path)
 * @param res - The Express response object
 * @param next - The Express next function for error handling
 * 
 * @returns A FriendsResponse containing:
 * - A list of Friend objects with the friend's profile information and friendship status
 * - A next_cursor for pagination (if more results are available)
 */
export const getMyFriends = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const db = getFirestore();
    const currentUserId = req.userId;

    logger.info(`Retrieving friends and pending requests for user: ${currentUserId}`);

    // Get pagination parameters from the validated request
    const validatedParams = req.validated_params;
    const limit = validatedParams?.limit || 20;
    const afterCursor = validatedParams?.after_cursor;

    logger.info(
        `Pagination parameters - limit: ${limit}, after_cursor: ${afterCursor}`
    );

    // Use a single efficient query with array_contains and in operator for multiple statuses
    let query = db
        .collection(Collections.FRIENDSHIPS)
        .where(FriendshipFields.MEMBERS, QueryOperators.ARRAY_CONTAINS, currentUserId)
        .where(
            FriendshipFields.STATUS,
            QueryOperators.IN,
            [Status.ACCEPTED, Status.PENDING]
        )
        .orderBy(FriendshipFields.CREATED_AT, QueryOperators.DESC);

    // Apply cursor-based pagination
    let paginatedQuery;
    try {
        paginatedQuery = await applyPagination(query, afterCursor, limit);
    } catch (err) {
        next(err);
        return; // Return after error to prevent further execution
    }

    // Process friendships using streaming
    const { items: friendshipDocs, lastDoc } = await processQueryStream<QueryDocumentSnapshot>(paginatedQuery, doc => doc);

    const friends: Friend[] = [];

    // Process friendships
    for (const friendshipDoc of friendshipDocs) {
        const friendshipData = friendshipDoc.data();
        const friendshipStatus = friendshipData[FriendshipFields.STATUS];

        // Determine if the current user is the sender or receiver
        const isSender = friendshipData[FriendshipFields.SENDER_ID] === currentUserId;

        const friend: Friend = {
            user_id: isSender
                ? friendshipData[FriendshipFields.RECEIVER_ID]
                : friendshipData[FriendshipFields.SENDER_ID],
            username: isSender
                ? friendshipData[FriendshipFields.RECEIVER_USERNAME] || ""
                : friendshipData[FriendshipFields.SENDER_USERNAME] || "",
            name: isSender
                ? friendshipData[FriendshipFields.RECEIVER_NAME] || ""
                : friendshipData[FriendshipFields.SENDER_NAME] || "",
            avatar: isSender
                ? friendshipData[FriendshipFields.RECEIVER_AVATAR] || ""
                : friendshipData[FriendshipFields.SENDER_AVATAR] || ""
        };

        logger.info(
            `Processing friendship with friend: ${friend.user_id}, status: ${friendshipStatus}`
        );

        friends.push(friend);
    }

    // Set up pagination for the next request
    const nextCursor = generateNextCursor(lastDoc, friends.length, limit);

    logger.info(
        `Retrieved ${friends.length} friends and pending requests for user: ${currentUserId}`
    );

    // Return the list of friends with pagination info
    const response: FriendsResponse = { friends, next_cursor: nextCursor };
    res.json(response);
}; 