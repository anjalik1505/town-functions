import { Request, Response } from "express";
import { InvitationFields, Status } from "../models/constants";
import { canActOnInvitation, formatInvitation, getInvitationDoc, hasInvitationPermission, updateInvitationStatus } from "../utils/invitation-utils";
import { getLogger } from "../utils/logging-utils";

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
export const rejectInvitation = async (req: Request, res: Response): Promise<void> => {
    const currentUserId = req.userId;
    const invitationId = req.params.invitation_id;
    logger.info(`User ${currentUserId} rejecting invitation ${invitationId}`);

    // Get the invitation document
    const { ref: invitationRef, data: invitationData } = await getInvitationDoc(invitationId);

    // Check invitation status
    const status = invitationData[InvitationFields.STATUS];
    canActOnInvitation(status, "reject");

    // Get the sender's user ID and ensure current user is not the sender
    const senderId = invitationData[InvitationFields.SENDER_ID];
    hasInvitationPermission(senderId, currentUserId, "reject");

    // Update the invitation status to rejected
    await updateInvitationStatus(invitationRef, Status.REJECTED);

    logger.info(`User ${currentUserId} rejected invitation ${invitationId}`);

    // Return the updated invitation
    const invitation = formatInvitation(invitationId, {
        ...invitationData,
        [InvitationFields.STATUS]: Status.REJECTED
    });

    res.json(invitation);
}; 