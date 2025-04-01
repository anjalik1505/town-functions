import { Request, Response } from "express";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { ChatFields, Collections, GroupFields } from "../models/constants";
import { ChatMessage } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { formatTimestamp } from "../utils/timestamp-utils";

const logger = getLogger(__filename);

/**
 * Creates a new chat message in a specific group.
 * 
 * This function adds a new message to the group's chats subcollection.
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: The validated request body containing:
 *                - text: The message text (required)
 *                - attachments: Optional list of attachment URLs
 * @param res - The Express response object
 * @param groupId - The ID of the group to add the chat message to
 * 
 * @returns A ChatMessage object representing the newly created message
 * 
 * @throws 404: Group not found
 * @throws 403: User is not a member of the group
 * @throws 400: Invalid request data (missing text)
 * @throws 500: Internal server error
 */
export const createGroupChatMessage = async (req: Request, res: Response, groupId: string): Promise<void> => {
    logger.info(`Creating new chat message in group: ${groupId}`);

    // Get the authenticated user ID from the request
    const currentUserId = req.userId;

    // Get the validated request data
    const validatedParams = req.validated_params;
    const text = validatedParams.text;
    const attachments = validatedParams.attachments ?? [];

    // Initialize Firestore client
    const db = getFirestore();

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
            description: "You must be a member of the group to post messages"
        });
    }

    // Create the chat message
    const chatsRef = groupRef.collection(Collections.CHATS);

    const currentTime = Timestamp.now();

    // Prepare the message data
    const messageData = {
        [ChatFields.SENDER_ID]: currentUserId,
        [ChatFields.TEXT]: text,
        [ChatFields.CREATED_AT]: currentTime,
        [ChatFields.ATTACHMENTS]: attachments
    };

    // Add the message to Firestore
    const newMessageRef = chatsRef.doc(); // Auto-generate ID
    await newMessageRef.set(messageData);

    logger.info(`Created new chat message with ID: ${newMessageRef.id}`);

    // Return the created message
    const response: ChatMessage = {
        message_id: newMessageRef.id,
        sender_id: currentUserId,
        text,
        created_at: formatTimestamp(currentTime),
        attachments
    };

    res.json(response);
}; 