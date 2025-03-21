import { Request, Response } from "express";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Collections, InvitationFields, QueryOperators, Status } from "../models/constants";
import { Invitation } from "../models/data-models";
import { getLogger } from "../utils/logging_utils";
import { formatTimestamp } from "../utils/timestamp_utils";

const logger = getLogger(__filename);

/**
 * Gets all invitations for the current user, checking if any have expired.
 * 
 * This function:
 * 1. Retrieves all invitations where the current user is the sender
 * 2. Checks if any pending invitations have expired and updates their status
 * 3. Returns all invitations to the user
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 * @param res - The Express response object
 * 
 * @returns An InvitationsResponse object containing all invitations
 */
export const getInvitations = async (req: Request, res: Response) => {
    const currentUserId = req.userId;
    logger.info(`Getting invitations for user ${currentUserId}`);

    // Initialize Firestore client
    const db = getFirestore();

    // Get all invitations where the current user is the sender
    const invitationsQuery = await db.collection(Collections.INVITATIONS)
        .where(InvitationFields.SENDER_ID, QueryOperators.EQUALS, currentUserId)
        .get();

    const invitations: Invitation[] = [];
    const batch = db.batch();
    let batchUpdated = false;

    const currentTime = Timestamp.now();

    // Process each invitation
    for (const doc of invitationsQuery.docs) {
        const invitationData = doc.data();
        const invitationId = doc.id;

        // Check if pending invitation has expired
        const status = invitationData[InvitationFields.STATUS];
        const expiresAt = invitationData[InvitationFields.EXPIRES_AT] as Timestamp;

        // Only update if the invitation is pending and has expired
        if (
            status === Status.PENDING &&
            expiresAt &&
            expiresAt.toDate() < currentTime.toDate()
        ) {
            // Use the document reference directly from the query
            batch.update(doc.ref, { [InvitationFields.STATUS]: Status.EXPIRED });
            batchUpdated = true;

            // Update status for the response
            invitationData[InvitationFields.STATUS] = Status.EXPIRED;
        }

        // Format timestamps for consistent API response
        const createdAt = invitationData[InvitationFields.CREATED_AT] as Timestamp;
        const createdAtIso = createdAt ? formatTimestamp(createdAt) : "";

        const expiresAtFormatted = invitationData[InvitationFields.EXPIRES_AT] as Timestamp;
        const expiresAtIso = expiresAtFormatted ? formatTimestamp(expiresAtFormatted) : "";

        // Create Invitation object
        const invitation: Invitation = {
            invitation_id: invitationId,
            created_at: createdAtIso,
            expires_at: expiresAtIso,
            sender_id: invitationData[InvitationFields.SENDER_ID] || "",
            status: invitationData[InvitationFields.STATUS] || "",
            username: invitationData[InvitationFields.USERNAME] || "",
            name: invitationData[InvitationFields.NAME] || "",
            avatar: invitationData[InvitationFields.AVATAR] || ""
        };

        invitations.push(invitation);
    }

    // Commit batch if any updates were made
    if (batchUpdated) {
        await batch.commit();
        logger.info(`Updated expired invitations for user ${currentUserId}`);
    }

    logger.info(`Retrieved ${invitations.length} invitations for user ${currentUserId}`);

    // Return the invitations response
    return res.json({ invitations });
}; 