import { Request, Response } from "express";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Collections, InvitationFields, Status } from "../models/constants";
import { Invitation } from "../models/data-models";
import { getLogger } from "../utils/logging_utils";

const logger = getLogger(__filename);

/**
 * Rejects an invitation by setting its status to rejected.
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: The route parameters containing:
 *                - invitation_id: The ID of the invitation to reject
 * @param res - The Express response object
 * 
 * @returns The updated Invitation object with status set to rejected
 * 
 * @throws {400} Invitation cannot be rejected (status: {status})
 * @throws {400} You cannot reject your own invitation
 * @throws {404} Invitation not found
 */
export const rejectInvitation = async (req: Request, res: Response) => {
    const currentUserId = req.userId;
    const invitationId = req.params.invitation_id;
    logger.info(`User ${currentUserId} rejecting invitation ${invitationId}`);

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

    // Check invitation status
    const status = invitationData?.[InvitationFields.STATUS];
    if (status !== Status.PENDING) {
        logger.warn(`Invitation ${invitationId} has status ${status}, not pending`);
        return res.status(400).json({
            code: 400,
            name: "Bad Request",
            description: `Invitation cannot be rejected (status: ${status})`
        });
    }

    // Get the sender's user ID and ensure current user is not the sender
    const senderId = invitationData?.[InvitationFields.SENDER_ID];
    if (senderId === currentUserId) {
        logger.warn(
            `User ${currentUserId} attempted to reject their own invitation ${invitationId}`
        );
        return res.status(400).json({
            code: 400,
            name: "Bad Request",
            description: "You cannot reject your own invitation"
        });
    }

    // Update the invitation status to rejected
    await invitationRef.update({ [InvitationFields.STATUS]: Status.REJECTED });

    logger.info(`User ${currentUserId} rejected invitation ${invitationId}`);

    // Format timestamps for consistent API response
    const createdAt = invitationData?.[InvitationFields.CREATED_AT] as Timestamp;
    const createdAtIso = createdAt?.toDate?.()?.toISOString() || "";

    const expiresAt = invitationData?.[InvitationFields.EXPIRES_AT] as Timestamp;
    const expiresAtIso = expiresAt?.toDate?.()?.toISOString() || "";

    // Return the updated invitation
    const invitation: Invitation = {
        invitation_id: invitationId,
        created_at: createdAtIso,
        expires_at: expiresAtIso,
        sender_id: invitationData?.[InvitationFields.SENDER_ID] || "",
        status: Status.REJECTED,
        username: invitationData?.[InvitationFields.USERNAME] || "",
        name: invitationData?.[InvitationFields.NAME] || "",
        avatar: invitationData?.[InvitationFields.AVATAR] || ""
    };

    return res.json(invitation);
}; 