import { NextFunction, Request, Response } from "express";
import { getFirestore, QueryDocumentSnapshot, Timestamp } from "firebase-admin/firestore";
import { Collections, InvitationFields, QueryOperators, Status } from "../models/constants";
import { Invitation, InvitationsResponse } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { applyPagination, generateNextCursor, processQueryStream } from "../utils/pagination-utils";
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
 *                - after_cursor: Cursor for pagination (base64 encoded document path)
 * @param res - The Express response object
 * @param next - The Express next function for error handling
 * 
 * @returns An InvitationsResponse object containing all invitations and pagination info
 */
export const getInvitations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const currentUserId = req.userId;
    logger.info(`Getting invitations for user ${currentUserId}`);

    // Initialize Firestore client
    const db = getFirestore();

    // Get pagination parameters from the validated request
    const validatedParams = req.validated_params;
    const limit = validatedParams?.limit || 20;
    const afterCursor = validatedParams?.after_cursor;

    logger.info(
        `Pagination parameters - limit: ${limit}, after_cursor: ${afterCursor}`
    );

    // Build the query
    let query = db.collection(Collections.INVITATIONS)
        .where(InvitationFields.SENDER_ID, QueryOperators.EQUALS, currentUserId)
        .orderBy(InvitationFields.CREATED_AT, QueryOperators.DESC);

    // Apply cursor-based pagination
    let paginatedQuery;
    try {
        paginatedQuery = await applyPagination(query, afterCursor, limit);
    } catch (err) {
        next(err);
        return; // Return after error to prevent further execution
    }

    // Process invitations using streaming
    const { items: invitationDocs, lastDoc } = await processQueryStream<QueryDocumentSnapshot>(paginatedQuery, doc => doc, limit);

    const invitations: Invitation[] = [];
    const batch = db.batch();
    let batchUpdated = false;
    const currentTime = Timestamp.now();

    // Process each invitation
    for (const doc of invitationDocs) {
        const invitationData = doc.data();
        const invitationId = doc.id;

        // Check if pending invitation has expired
        const status = invitationData[InvitationFields.STATUS];
        const createdAt = invitationData?.[InvitationFields.CREATED_AT] as Timestamp;
        const expiresAt = invitationData?.[InvitationFields.EXPIRES_AT] as Timestamp;

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

        // Create Invitation object
        const invitation: Invitation = {
            invitation_id: invitationId,
            created_at: createdAt ? formatTimestamp(createdAt) : "",
            expires_at: expiresAt ? formatTimestamp(expiresAt) : "",
            sender_id: invitationData[InvitationFields.SENDER_ID] || "",
            status: invitationData[InvitationFields.STATUS] || "",
            username: invitationData[InvitationFields.USERNAME] || "",
            name: invitationData[InvitationFields.NAME] || "",
            avatar: invitationData[InvitationFields.AVATAR] || "",
            receiver_name: invitationData[InvitationFields.RECEIVER_NAME] || ""
        };

        invitations.push(invitation);
    }

    // Commit batch if any updates were made
    if (batchUpdated) {
        await batch.commit();
        logger.info(`Updated expired invitations for user ${currentUserId}`);
    }

    // Set up pagination for the next request
    const nextCursor = generateNextCursor(lastDoc, invitations.length, limit);

    logger.info(`Retrieved ${invitations.length} invitations for user ${currentUserId}`);

    // Return the invitations response with pagination info
    const response: InvitationsResponse = { invitations, next_cursor: nextCursor };
    res.json(response);
}; 