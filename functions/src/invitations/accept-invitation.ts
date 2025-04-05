import { Request, Response } from "express";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Collections, FriendshipFields, InvitationFields, ProfileFields, Status } from "../models/constants";
import { Friend } from "../models/data-models";
import { BadRequestError, ForbiddenError } from "../utils/errors";
import { createFriendshipId, hasReachedCombinedLimit } from "../utils/friendship-utils";
import { canActOnInvitation, getInvitationDoc, hasInvitationPermission, isInvitationExpired, updateInvitationStatus } from "../utils/invitation-utils";
import { getLogger } from "../utils/logging-utils";
import { getProfileDoc } from "../utils/profile-utils";

const logger = getLogger(__filename);

/**
 * Accepts an invitation and creates a friendship between the users.
 * 
 * This function:
 * 1. Checks if the invitation exists and is still valid
 * 2. Creates a new friendship document between the accepting user and the sender
 * 3. Deletes the invitation document
 * 
 * Validates that:
 * 1. The accepting user hasn't reached the combined limit of friends and active invitations (5)
 * 2. The sender hasn't reached the combined limit of friends and active invitations (5)
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Route parameters containing:
 *                - invitation_id: The ID of the invitation to accept
 * @param res - The Express response object
 * 
 * @returns A Friend object representing the new friendship
 * 
 * @throws 400: Invitation cannot be accepted (status: {status})
 * @throws 400: Invitation has expired
 * @throws 400: You cannot accept your own invitation
 * @throws 400: User has reached the maximum number of friends and active invitations
 * @throws 400: Sender has reached the maximum number of friends and active invitations
 * @throws 404: Invitation not found
 * @throws 404: User profile not found
 * @throws 404: Sender profile not found
 */
export const acceptInvitation = async (req: Request, res: Response): Promise<void> => {
    const currentUserId = req.userId;
    const invitationId = req.params.invitation_id;

    logger.info(`User ${currentUserId} accepting invitation ${invitationId}`);

    // Initialize Firestore client
    const db = getFirestore();

    // Get the invitation document
    const { ref: invitationRef, data: invitationData } = await getInvitationDoc(invitationId);

    // Check invitation status
    const status = invitationData[InvitationFields.STATUS];
    canActOnInvitation(status, "accept");

    // Check if invitation has expired
    const expiresAt = invitationData[InvitationFields.EXPIRES_AT] as Timestamp;
    if (isInvitationExpired(expiresAt)) {
        // Update invitation status to expired
        await updateInvitationStatus(invitationRef, Status.EXPIRED);
        throw new ForbiddenError("Invitation has expired");
    }

    // Get the sender's user ID
    const senderId = invitationData[InvitationFields.SENDER_ID];

    // Ensure the current user is not the sender (can't accept your own invitation)
    hasInvitationPermission(senderId, currentUserId, "accept");

    // Check combined limit for the accepting user
    const hasReachedLimit = await hasReachedCombinedLimit(currentUserId);
    if (hasReachedLimit) {
        throw new BadRequestError("You have reached the maximum number of friends and active invitations");
    }

    // Check combined limit for the sender (excluding this invitation)
    const hasReachedSenderLimit = await hasReachedCombinedLimit(senderId, invitationId);
    if (hasReachedSenderLimit) {
        throw new BadRequestError("Sender has reached the maximum number of friends and active invitations");
    }

    // Get current user's profile
    const { data: currentUserProfile } = await getProfileDoc(currentUserId);

    // Get sender's profile
    const { data: senderProfile } = await getProfileDoc(senderId);

    // Create a batch operation for atomicity
    const batch = db.batch();

    // Create a consistent friendship ID by sorting the user IDs
    const friendshipId = createFriendshipId(currentUserId, senderId);

    // Check if friendship already exists
    const friendshipRef = db.collection(Collections.FRIENDSHIPS).doc(friendshipId);
    const friendshipDoc = await friendshipRef.get();

    if (friendshipDoc.exists) {
        const friendshipData = friendshipDoc.data() || {};
        const friendshipStatus = friendshipData[FriendshipFields.STATUS];

        if (friendshipStatus === Status.ACCEPTED) {
            logger.warn(`Users ${currentUserId} and ${senderId} are already friends`);
            // Delete the invitation since they're already friends
            batch.delete(invitationRef);
            await batch.commit();

            // Return the existing friend using data from the friendship document
            let friendName: string;
            let friendUsername: string;
            let friendAvatar: string;

            if (friendshipData[FriendshipFields.SENDER_ID] === senderId) {
                friendName = friendshipData[FriendshipFields.SENDER_NAME] || "";
                friendUsername = friendshipData[FriendshipFields.SENDER_USERNAME] || "";
                friendAvatar = friendshipData[FriendshipFields.SENDER_AVATAR] || "";
            } else {
                friendName = friendshipData[FriendshipFields.RECEIVER_NAME] || "";
                friendUsername = friendshipData[FriendshipFields.RECEIVER_USERNAME] || "";
                friendAvatar = friendshipData[FriendshipFields.RECEIVER_AVATAR] || "";
            }

            const friend: Friend = {
                user_id: senderId,
                username: friendUsername,
                name: friendName,
                avatar: friendAvatar
            };

            res.json(friend);
        }
    }

    // Create the friendship document using profile data directly
    const currentTime = Timestamp.now();
    const friendshipData = {
        [FriendshipFields.SENDER_ID]: senderId,
        [FriendshipFields.SENDER_NAME]: senderProfile[ProfileFields.NAME] || "",
        [FriendshipFields.SENDER_USERNAME]: senderProfile[ProfileFields.USERNAME] || "",
        [FriendshipFields.SENDER_AVATAR]: senderProfile[ProfileFields.AVATAR] || "",
        [FriendshipFields.RECEIVER_ID]: currentUserId,
        [FriendshipFields.RECEIVER_NAME]: currentUserProfile[ProfileFields.NAME] || "",
        [FriendshipFields.RECEIVER_USERNAME]: currentUserProfile[ProfileFields.USERNAME] || "",
        [FriendshipFields.RECEIVER_AVATAR]: currentUserProfile[ProfileFields.AVATAR] || "",
        [FriendshipFields.STATUS]: Status.ACCEPTED,
        [FriendshipFields.CREATED_AT]: currentTime,
        [FriendshipFields.UPDATED_AT]: currentTime,
        [FriendshipFields.MEMBERS]: [senderId, currentUserId]
    };

    // Add operations to batch
    batch.set(friendshipRef, friendshipData);
    batch.delete(invitationRef);

    // Commit the batch
    await batch.commit();

    logger.info(`User ${currentUserId} accepted invitation ${invitationId} from ${senderId}`);

    // Return the friend object using sender's profile data
    const friend: Friend = {
        user_id: senderId,
        username: senderProfile[ProfileFields.USERNAME] || "",
        name: senderProfile[ProfileFields.NAME] || "",
        avatar: senderProfile[ProfileFields.AVATAR] || ""
    };

    res.json(friend);
}; 