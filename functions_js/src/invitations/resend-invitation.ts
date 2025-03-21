import { Request, Response } from "express";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Collections, InvitationFields, Status } from "../models/constants";
import { Invitation } from "../models/data-models";
import { getLogger } from "../utils/logging_utils";

const logger = getLogger(__filename);

/**
 * Resends an invitation by resetting its created_at time and updating the expires_at time.
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: The route parameters containing:
 *                - invitation_id: The ID of the invitation to resend
 * @param res - The Express response object
 * 
 * @returns The updated Invitation object with refreshed timestamps
 * 
 * @throws {403} You can only resend your own invitations
 * @throws {404} Invitation not found
 */
export const resendInvitation = async (req: Request, res: Response) => {
    const currentUserId = req.userId;
    const invitationId = req.params.invitation_id;
    logger.info(`User ${currentUserId} resending invitation ${invitationId}`);

    // Initialize Firestore client
    const db = getFirestore();

    // Get the invitation document
    const invitationRef = db.collection(Collections.INVITATIONS).doc(invitationId);
    const invitationDoc = await invitationRef.get();

    // Check if the invitation exists
    if (!invitationDoc.exists) {
        logger.warn(`Invitation ${invitationId} not found`);
        return res.status(404).json({
            code: 404,
            name: "Not Found",
            description: "Invitation not found"
        });
    }

    const invitationData = invitationDoc.data();

    // Check if the current user is the sender of the invitation
    const senderId = invitationData?.[InvitationFields.SENDER_ID];
    if (senderId !== currentUserId) {
        logger.warn(
            `User ${currentUserId} is not the sender of invitation ${invitationId}`
        );
        return res.status(403).json({
            code: 403,
            name: "Forbidden",
            description: "You can only resend your own invitations"
        });
    }

    // Set new timestamps
    const currentTime = Timestamp.now();
    const expiresAt = new Timestamp(
        currentTime.seconds + 24 * 60 * 60, // Add 24 hours in seconds
        currentTime.nanoseconds
    );

    // Update the invitation with new timestamps
    await invitationRef.update({
        [InvitationFields.CREATED_AT]: currentTime,
        [InvitationFields.EXPIRES_AT]: expiresAt,
        [InvitationFields.STATUS]: Status.PENDING
    });

    logger.info(`User ${currentUserId} resent invitation ${invitationId}`);

    // Return the updated invitation
    const invitation: Invitation = {
        invitation_id: invitationId,
        created_at: currentTime.toDate().toISOString(),
        expires_at: expiresAt.toDate().toISOString(),
        sender_id: currentUserId,
        status: Status.PENDING,
        username: invitationData?.[InvitationFields.USERNAME] || "",
        name: invitationData?.[InvitationFields.NAME] || "",
        avatar: invitationData?.[InvitationFields.AVATAR] || ""
    };

    return res.json(invitation);
}; 