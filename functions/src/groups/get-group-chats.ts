import { Request, Response } from "express";
import { getFirestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { ChatFields, Collections, GroupFields } from "../models/constants";
import { ChatMessage, ChatResponse } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";

const logger = getLogger(__filename);

/**
 * Retrieves chat messages for a specific group with pagination.
 * 
 * This function fetches messages from the group's chats subcollection,
 * ordered by creation time (newest first) and with pagination support.
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Pagination parameters containing:
 *                - limit: Maximum number of messages to return
 *                - after_timestamp: Timestamp for pagination
 * @param res - The Express response object
 * @param groupId - The ID of the group to retrieve chat messages for
 * 
 * Query Parameters:
 * - limit: Maximum number of messages to return (default: 20, min: 1, max: 100)
 * - after_timestamp: Timestamp for pagination in ISO format (e.g. "2025-01-01T12:00:00Z")
 * 
 * @returns A ChatResponse containing:
 * - A list of chat messages for the specified group
 * - A next_timestamp for pagination (if more results are available)
 * 
 * @throws 404: Group not found
 * @throws 403: User is not a member of the group
 * @throws 500: Internal server error
 */
export const getGroupChats = async (req: Request, res: Response, groupId: string): Promise<void> => {
    logger.info(`Retrieving chat messages for group: ${groupId}`);

    // Get the authenticated user ID from the request
    const currentUserId = req.userId;

    // Initialize Firestore client
    const db = getFirestore();

    // Get pagination parameters from the validated request
    const validatedParams = req.validated_params;
    const limit = validatedParams?.limit || 20;
    const afterTimestamp = validatedParams?.after_timestamp;

    logger.info(
        `Pagination parameters - limit: ${limit}, after_timestamp: ${afterTimestamp}`
    );

    // First, check if the group exists and if the user is a member
    const groupRef = db.collection(Collections.GROUPS).doc(groupId);
    const groupDoc = await groupRef.get();

    if (!groupDoc.exists) {
        logger.warn(`Group ${groupId} not found`);
        res.status(404).json({
            code: 404,
            name: "Not Found",
            description: "Group not found"
        });
    }

    const groupData = groupDoc.data() || {};
    const members = groupData[GroupFields.MEMBERS] || [];

    // Check if the current user is a member of the group
    if (!members.includes(currentUserId)) {
        logger.warn(`User ${currentUserId} is not a member of group ${groupId}`);
        res.status(403).json({
            code: 403,
            name: "Forbidden",
            description: "You must be a member of the group to view its chat messages"
        });
    }

    // Set up the query for chat messages
    const chatsRef = groupRef.collection(Collections.CHATS);

    // Build the query: first ordering, then pagination, then limit
    let query = chatsRef.orderBy(
        ChatFields.CREATED_AT,
        "desc"
    );

    // Apply pagination if an after_timestamp is provided
    if (afterTimestamp) {
        query = query.startAfter({ [ChatFields.CREATED_AT]: afterTimestamp });
        logger.info(`Applying pagination with timestamp: ${afterTimestamp}`);
    }

    // Apply limit last
    query = query.limit(limit);

    // Execute the query
    const messages: ChatMessage[] = [];
    let lastTimestamp: string | null = null;

    // Process the query results using streaming
    for await (const doc of query.stream()) {
        const updateDoc = doc as unknown as QueryDocumentSnapshot;
        const docData = updateDoc.data();
        const createdAt = docData[ChatFields.CREATED_AT] || "";

        // Track the last timestamp for pagination
        if (createdAt) {
            lastTimestamp = createdAt;
        }

        // Convert Firestore document to ChatMessage model
        const message: ChatMessage = {
            message_id: updateDoc.id,
            sender_id: docData[ChatFields.SENDER_ID] || "",
            text: docData[ChatFields.TEXT] || "",
            created_at: createdAt,
            attachments: docData[ChatFields.ATTACHMENTS] || []
        };
        messages.push(message);
    }

    logger.info("Query executed successfully");

    // Set up pagination for the next request
    let nextTimestamp: string | null = null;
    if (lastTimestamp && messages.length === limit) {
        nextTimestamp = lastTimestamp;
        logger.info(`More results available, next_timestamp: ${nextTimestamp}`);
    }

    logger.info(`Retrieved ${messages.length} chat messages for group: ${groupId}`);

    // Return the response
    const response: ChatResponse = {
        messages,
        next_timestamp: nextTimestamp
    };

    res.json(response);
}; 