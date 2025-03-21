import { Request, Response } from "express";
import { getFirestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { Collections, FriendshipFields, QueryOperators, Status } from "../models/constants";
import { Friend } from "../models/data-models";
import { getLogger } from "../utils/logging_utils";

const logger = getLogger(__filename);

/**
 * Retrieves the current user's friends and pending friendship requests.
 * 
 * This function fetches all accepted and pending friendships where the current user
 * is in the members array, and returns the friend's information with status.
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 * @param res - The Express response object
 * 
 * @returns A FriendsResponse containing:
 * - A list of Friend objects with the friend's profile information and friendship status
 */
export const getMyFriends = async (req: Request, res: Response) => {
    const db = getFirestore();
    const currentUserId = req.userId;

    logger.info(`Retrieving friends and pending requests for user: ${currentUserId}`);

    // Use a single efficient query with array_contains and in operator for multiple statuses
    const friendshipsQuery = db
        .collection(Collections.FRIENDSHIPS)
        .where(FriendshipFields.MEMBERS, QueryOperators.ARRAY_CONTAINS, currentUserId)
        .where(
            FriendshipFields.STATUS,
            QueryOperators.IN,
            [Status.ACCEPTED, Status.PENDING]
        );

    logger.info(`Querying friendships for user: ${currentUserId}`);

    const friends: Friend[] = [];

    // Process friendships as they stream in
    for await (const doc of friendshipsQuery.stream()) {
        const friendshipDoc = doc as unknown as QueryDocumentSnapshot;
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

    logger.info(
        `Retrieved ${friends.length} friends and pending requests for user: ${currentUserId}`
    );

    // Return the list of friends
    return res.json({ friends });
}; 