import { Request, Response } from "express";
import { getFirestore, QueryDocumentSnapshot, Timestamp } from "firebase-admin/firestore";
import { Collections, FriendshipFields, QueryOperators, Status } from "../models/constants";
import { Friend, FriendsResponse } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { formatTimestamp } from "../utils/timestamp-utils";

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
 *                - after_timestamp: Timestamp for pagination in ISO format
 * @param res - The Express response object
 * 
 * @returns A FriendsResponse containing:
 * - A list of Friend objects with the friend's profile information and friendship status
 * - A next_timestamp for pagination (if more results are available)
 */
export const getMyFriends = async (req: Request, res: Response) => {
    const db = getFirestore();
    const currentUserId = req.userId;

    logger.info(`Retrieving friends and pending requests for user: ${currentUserId}`);

    // Get pagination parameters from the validated request
    const validatedParams = req.validated_params;
    const limit = validatedParams?.limit || 20;
    const afterTimestamp = validatedParams?.after_timestamp;

    logger.info(
        `Pagination parameters - limit: ${limit}, after_timestamp: ${afterTimestamp}`
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
        .orderBy(FriendshipFields.CREATED_AT, "desc");

    // Apply pagination if an after_timestamp is provided
    if (afterTimestamp) {
        query = query.startAfter({ [FriendshipFields.CREATED_AT]: afterTimestamp });
        logger.info(`Applying pagination with timestamp: ${afterTimestamp}`);
    }

    // Apply limit last
    query = query.limit(limit);

    logger.info(`Querying friendships for user: ${currentUserId}`);

    const friends: Friend[] = [];
    let lastTimestamp: Timestamp | null = null;

    // Process friendships as they stream in
    for await (const doc of query.stream()) {
        const friendshipDoc = doc as unknown as QueryDocumentSnapshot;
        const friendshipData = friendshipDoc.data();
        const friendshipStatus = friendshipData[FriendshipFields.STATUS];
        const createdAt = friendshipData[FriendshipFields.CREATED_AT] as Timestamp;

        // Track the last timestamp for pagination
        if (createdAt) {
            lastTimestamp = createdAt;
        }

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
    let nextTimestamp: string | null = null;
    if (lastTimestamp && friends.length === limit) {
        // Convert the timestamp to ISO format for pagination
        nextTimestamp = formatTimestamp(lastTimestamp);
        logger.info(`More results available, next_timestamp: ${nextTimestamp}`);
    }

    logger.info(
        `Retrieved ${friends.length} friends and pending requests for user: ${currentUserId}`
    );

    // Return the list of friends with pagination info
    const response: FriendsResponse = { friends, next_timestamp: nextTimestamp };
    return res.json(response);
}; 