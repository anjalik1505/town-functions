import { Request, Response } from "express";
import { getFirestore } from "firebase-admin/firestore";
import { Collections, FriendshipFields, ProfileFields, Status, UserSummaryFields } from "../models/constants";
import { FriendProfileResponse } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { formatTimestamp } from "../utils/timestamp-utils";

const logger = getLogger(__filename);

/**
 * Retrieves a user's profile with summary and suggestions.
 * 
 * This function fetches the profile of the specified user, including their basic profile
 * information and aggregated summary data. Summary data is collected from shared groups
 * and direct chats between the current user and the requested user. The function enforces
 * friendship checks to ensure only friends can view each other's profiles.
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Route parameters containing:
 *                - target_user_id: The ID of the user whose profile is being requested
 * @param res - The Express response object
 * 
 * @returns A FriendProfileResponse containing:
 * - Basic profile information (id, name, avatar)
 * - Location and birthday if available
 * - Summary and suggestions if available
 * - Updated timestamp
 * 
 * @throws 400: Use /me/profile endpoint to view your own profile
 * @throws 404: Profile not found
 * @throws 403: You must be friends with this user to view their profile
 */
export const getUserProfile = async (req: Request, res: Response) => {
    const currentUserId = req.userId;
    const targetUserId = req.params.target_user_id;

    logger.info(
        `Retrieving profile for user ${targetUserId} requested by ${currentUserId}`
    );

    const db = getFirestore();

    // Redirect users to the appropriate endpoint for their own profile
    if (currentUserId === targetUserId) {
        logger.warn(
            `User ${currentUserId} attempted to view their own profile through /user endpoint`
        );
        return res.status(400).json({
            code: 400,
            name: "Bad Request",
            description: "Use /me/profile endpoint to view your own profile"
        });
    }

    // Get the target user's profile
    const targetUserProfileRef = db.collection(Collections.PROFILES).doc(targetUserId);
    const targetUserProfileDoc = await targetUserProfileRef.get();

    // Check if the target profile exists
    if (!targetUserProfileDoc.exists) {
        logger.warn("Profile not found");
        return res.status(404).json({
            code: 404,
            name: "Not Found",
            description: "Profile not found"
        });
    }

    const targetUserProfileData = targetUserProfileDoc.data() || {};

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
            `User ${currentUserId} attempted to view profile of non-friend ${targetUserId}`
        );
        return res.status(403).json({
            code: 403,
            name: "Forbidden",
            description: "You must be friends with this user to view their profile"
        });
    }

    logger.info(`Friendship verified between ${currentUserId} and ${targetUserId}`);

    // Sort user IDs to create a consistent relationship ID (same logic as in process_friend_summary)
    const relationshipId = `${userIds[0]}_${userIds[1]}`;

    // Get the user summary document for this friendship
    const userSummaryRef = db.collection(Collections.USER_SUMMARIES).doc(relationshipId);
    const userSummaryDoc = await userSummaryRef.get();

    // Initialize summary and suggestions
    let summary = "";
    let suggestions = "";

    if (userSummaryDoc.exists) {
        const userSummaryData = userSummaryDoc.data() || {};
        // Only return the summary if the current user is the target (the one who should see it)
        if (userSummaryData[UserSummaryFields.TARGET_ID] === currentUserId) {
            summary = userSummaryData[UserSummaryFields.SUMMARY] || "";
            suggestions = userSummaryData[UserSummaryFields.SUGGESTIONS] || "";
            logger.info(`Retrieved user summary for relationship ${relationshipId}`);
        } else {
            logger.info(`User ${currentUserId} is not the target for this summary`);
        }
    } else {
        logger.info(`No user summary found for relationship ${relationshipId}`);
    }

    // Format updated_at timestamp - Firestore Timestamp to ISO string
    const updatedAt = targetUserProfileData[ProfileFields.UPDATED_AT] ? formatTimestamp(targetUserProfileData[ProfileFields.UPDATED_AT]) : "";

    // Return a FriendProfileResponse with the user's profile information and summary/suggestions if available
    const response: FriendProfileResponse = {
        user_id: targetUserId,
        username: targetUserProfileData[ProfileFields.USERNAME] || "",
        name: targetUserProfileData[ProfileFields.NAME] || "",
        avatar: targetUserProfileData[ProfileFields.AVATAR] || "",
        location: targetUserProfileData[ProfileFields.LOCATION] || "",
        birthday: targetUserProfileData[ProfileFields.BIRTHDAY] || "",
        gender: targetUserProfileData[ProfileFields.GENDER] || "",
        summary,
        suggestions,
        updated_at: updatedAt
    };

    return res.json(response);
}; 