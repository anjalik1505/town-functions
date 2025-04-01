import { Request, Response } from "express";
import { getFirestore } from "firebase-admin/firestore";
import { Collections, InvitationFields } from "../models/constants";
import { Invitation } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { formatTimestamp } from "../utils/timestamp-utils";

const logger = getLogger(__filename);

/**
 * Gets a single invitation by ID.
 * 
 * This function:
 * 1. Retrieves the invitation document by ID
 * 2. Verifies the user has permission to view it
 * 3. Returns the invitation data
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Request parameters containing:
 *                - invitation_id: The ID of the invitation to retrieve
 * @param res - The Express response object
 * 
 * @returns An Invitation object containing the invitation data
 * 
 * @throws 403: You can only view your own invitations
 * @throws 404: Invitation not found
 */
export const getInvitation = async (req: Request, res: Response) => {
    const currentUserId = req.userId;
    const invitationId = req.params.invitation_id;
    logger.info(`Getting invitation ${invitationId} for user ${currentUserId}`);

    // Initialize Firestore client
    const db = getFirestore();

    // Get the invitation document
    const invitationDoc = await db.collection(Collections.INVITATIONS).doc(invitationId).get();

    // Check if invitation exists
    if (!invitationDoc.exists) {
        logger.warn(`Invitation ${invitationId} not found`);
        res.status(404).json({
            code: 404,
            name: "Not Found",
            description: "Invitation not found"
        });
        return;
    }

    const invitationData = invitationDoc.data() || {};

    // Verify the user has permission to view this invitation
    const senderId = invitationData[InvitationFields.SENDER_ID];
    if (senderId !== currentUserId) {
        logger.warn(`User ${currentUserId} attempted to view invitation ${invitationId} created by user ${senderId}`);
        res.status(403).json({
            code: 403,
            name: "Forbidden",
            description: "You can only view your own invitations"
        });
        return;
    }

    // Format timestamps for consistent API response
    const createdAt = invitationData[InvitationFields.CREATED_AT];
    const expiresAt = invitationData[InvitationFields.EXPIRES_AT];
    const createdAtIso = createdAt ? formatTimestamp(createdAt) : "";
    const expiresAtIso = expiresAt ? formatTimestamp(expiresAt) : "";

    // Create Invitation object
    const invitation: Invitation = {
        invitation_id: invitationId,
        created_at: createdAtIso,
        expires_at: expiresAtIso,
        sender_id: senderId,
        status: invitationData[InvitationFields.STATUS] || "",
        username: invitationData[InvitationFields.USERNAME] || "",
        name: invitationData[InvitationFields.NAME] || "",
        avatar: invitationData[InvitationFields.AVATAR] || "",
        receiver_name: invitationData[InvitationFields.RECEIVER_NAME] || ""
    };

    logger.info(`Successfully retrieved invitation ${invitationId} for user ${currentUserId}`);
    return res.json(invitation);
}; 