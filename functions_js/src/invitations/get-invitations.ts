import { Request, Response } from "express";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Collections, InvitationFields, QueryOperators, Status } from "../models/constants";
import { Invitation, InvitationsResponse } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { formatTimestamp } from "../utils/timestamp-utils";

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
 *              - validated_params: Pagination parameters containing:
 *                - limit: Maximum number of invitations to return (default: 20, min: 1, max: 100)
 *                - after_timestamp: Timestamp for pagination in ISO format
 * @param res - The Express response object
 * 
 * @returns An InvitationsResponse object containing all invitations and pagination info
 */
export const getInvitations = async (req: Request, res: Response) => {
    const currentUserId = req.userId;
    logger.info(`Getting invitations for user ${currentUserId}`);

    // Initialize Firestore client
    const db = getFirestore();

    // Get pagination parameters from the validated request
    const validatedParams = req.validated_params;
    const limit = validatedParams?.limit || 20;
    const afterTimestamp = validatedParams?.after_timestamp;

    logger.info(
        `Pagination parameters - limit: ${limit}, after_timestamp: ${afterTimestamp}`
    );

    // Build the query
    let query = db.collection(Collections.INVITATIONS)
        .where(InvitationFields.SENDER_ID, QueryOperators.EQUALS, currentUserId)
        .orderBy(InvitationFields.CREATED_AT, "desc");

    // Apply pagination if an after_timestamp is provided
    if (afterTimestamp) {
        query = query.startAfter({ [InvitationFields.CREATED_AT]: afterTimestamp });
        logger.info(`Applying pagination with timestamp: ${afterTimestamp}`);
    }

    // Apply limit last
    query = query.limit(limit);

    // Get all invitations where the current user is the sender
    const invitationsQuery = await query.get();

    const invitations: Invitation[] = [];
    const batch = db.batch();
    let batchUpdated = false;
    let lastTimestamp: Timestamp | null = null;

    const currentTime = Timestamp.now();

    // Process each invitation
    for (const doc of invitationsQuery.docs) {
        const invitationData = doc.data();
        const invitationId = doc.id;

        // Check if pending invitation has expired
        const status = invitationData[InvitationFields.STATUS];
        const expiresAt = invitationData[InvitationFields.EXPIRES_AT] as Timestamp;
        const createdAt = invitationData[InvitationFields.CREATED_AT] as Timestamp;

        // Track the last timestamp for pagination
        if (createdAt) {
            lastTimestamp = createdAt;
        }

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
        const createdAtIso = createdAt ? formatTimestamp(createdAt) : "";
        const expiresAtIso = expiresAt ? formatTimestamp(expiresAt) : "";

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

    // Set up pagination for the next request
    let nextTimestamp: string | null = null;
    if (lastTimestamp && invitations.length === limit) {
        // Convert the timestamp to ISO format for pagination
        nextTimestamp = formatTimestamp(lastTimestamp);
        logger.info(`More results available, next_timestamp: ${nextTimestamp}`);
    }

    logger.info(`Retrieved ${invitations.length} invitations for user ${currentUserId}`);

    // Return the invitations response with pagination info
    const response: InvitationsResponse = { invitations, next_timestamp: nextTimestamp };
    return res.json(response);
}; 