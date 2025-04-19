import { Request, Response } from "express";
import { formatInvitation, getInvitationDoc } from "../utils/invitation-utils";
import { getLogger } from "../utils/logging-utils";

const logger = getLogger(__filename);

/**
 * Gets a single invitation by ID.
 * 
 * This function:
 * 1. Retrieves the invitation document by ID
 * 2. Returns the invitation data
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Request parameters containing:
 *                - invitation_id: The ID of the invitation to retrieve
 * @param res - The Express response object
 * 
 * @returns An Invitation object containing the invitation data
 * 
 * @throws 404: Invitation not found
 */
export const getInvitation = async (req: Request, res: Response): Promise<void> => {
    const currentUserId = req.userId;
    const invitationId = req.params.invitation_id;

    logger.info(`Getting invitation ${invitationId} for user ${currentUserId}`);

    // Get the invitation document
    const { data: invitationData } = await getInvitationDoc(invitationId);

    // Format and return the invitation
    const invitation = formatInvitation(invitationId, invitationData);

    logger.info(`Successfully retrieved invitation ${invitationId} for user ${currentUserId}`);
    res.json(invitation);
}; 