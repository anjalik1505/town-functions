import { Request, Response } from "express";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Collections, InvitationFields, ProfileFields, Status } from "../models/constants";
import { Invitation } from "../models/data-models";
import { hasReachedCombinedLimit } from "../utils/friendship-utils";
import { getLogger } from "../utils/logging-utils";
import { formatTimestamp } from "../utils/timestamp-utils";

const logger = getLogger(__filename);

/**
 * Creates a new invitation from the current user.
 * 
 * This function creates a new invitation document in the invitations collection.
 * The invitation will have a pending status and will expire after 1 day.
 * 
 * Validates that:
 * 1. The user hasn't reached the combined limit of friends and active invitations (5)
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: The validated request body containing:
 *                - receiver_name: The name of the person being invited
 * @param res - The Express response object
 * 
 * @returns An Invitation object representing the newly created invitation
 * 
 * @throws 400: User has reached the maximum number of friends and active invitations
 * @throws 404: User profile not found
 */
export const createInvitation = async (req: Request, res: Response) => {
    const currentUserId = req.userId;
    logger.info(`Creating invitation for user ${currentUserId}`);

    // Check combined limit
    const hasReachedLimit = await hasReachedCombinedLimit(currentUserId);
    if (hasReachedLimit) {
        logger.warn(`User ${currentUserId} has reached the maximum number of friends and active invitations`);
        return res.status(400).json({
            code: 400,
            name: "Bad Request",
            description: "You have reached the maximum number of friends and active invitations"
        });
    }

    // Initialize Firestore client
    const db = getFirestore();

    // Get current user's profile for name and avatar
    const currentUserProfileRef = db.collection(Collections.PROFILES).doc(currentUserId);
    const currentUserProfileDoc = await currentUserProfileRef.get();

    if (!currentUserProfileDoc.exists) {
        logger.warn(`Current user profile ${currentUserId} not found`);
        return res.status(404).json({
            code: 404,
            name: "Not Found",
            description: "User profile not found"
        });
    }

    const currentUserProfile = currentUserProfileDoc.data() || {};
    const validatedParams = req.validated_params;

    // Create a new invitation document
    const invitationRef = db.collection(Collections.INVITATIONS).doc();

    // Set expiration time (1 day from now)
    const currentTime = Timestamp.now();
    const expiresAt = new Timestamp(
        currentTime.seconds + 24 * 60 * 60, // Add 24 hours in seconds
        currentTime.nanoseconds
    );

    // Create invitation data
    const invitationData = {
        [InvitationFields.SENDER_ID]: currentUserId,
        [InvitationFields.USERNAME]: currentUserProfile[ProfileFields.USERNAME] || "",
        [InvitationFields.NAME]: currentUserProfile[ProfileFields.NAME] || "",
        [InvitationFields.AVATAR]: currentUserProfile[ProfileFields.AVATAR] || "",
        [InvitationFields.STATUS]: Status.PENDING,
        [InvitationFields.CREATED_AT]: currentTime,
        [InvitationFields.EXPIRES_AT]: expiresAt,
        [InvitationFields.RECEIVER_NAME]: validatedParams.receiver_name,
    };

    // Set the invitation document
    await invitationRef.set(invitationData);

    logger.info(`Created invitation with ID ${invitationRef.id}`);

    // Return the invitation object
    const invitation: Invitation = {
        invitation_id: invitationRef.id,
        created_at: formatTimestamp(currentTime),
        expires_at: formatTimestamp(expiresAt),
        sender_id: currentUserId,
        status: Status.PENDING,
        username: currentUserProfile[ProfileFields.USERNAME] || "",
        name: currentUserProfile[ProfileFields.NAME] || "",
        avatar: currentUserProfile[ProfileFields.AVATAR] || "",
        receiver_name: validatedParams.receiver_name
    };

    return res.status(201).json(invitation);
}; 