import { Request, Response } from 'express';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { Collections } from '../models/constants.js';
import { ChatMessage, CreateChatMessagePayload } from '../models/data-models.js';
import { chatConverter, ChatDoc } from '../models/firestore/chat-doc.js';
import { groupConverter } from '../models/firestore/group-doc.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

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
  const validatedParams = req.validated_params as CreateChatMessagePayload;
  const text = validatedParams.text;
  const attachments = validatedParams.attachments ?? [];

  // Initialize Firestore client
  const db = getFirestore();

  // First, check if the group exists and if the user is a member
  const groupRef = db.collection(Collections.GROUPS).withConverter(groupConverter).doc(groupId);
  const groupDoc = await groupRef.get();

  if (!groupDoc.exists) {
    logger.warn(`Group ${groupId} not found`);
    throw new NotFoundError('Group not found');
  }

  const groupData = groupDoc.data();
  const members = groupData?.members || [];

  // Check if the current user is a member of the group
  if (!members.includes(currentUserId)) {
    logger.warn(`User ${currentUserId} is not a member of group ${groupId}`);
    throw new ForbiddenError('You must be a member of the group to post messages');
  }

  // Create the chat message
  const chatsRef = db
    .collection(Collections.GROUPS)
    .doc(groupId)
    .collection(Collections.CHATS)
    .withConverter(chatConverter);

  const currentTime = Timestamp.now();

  // Prepare the message data
  const messageData: ChatDoc = {
    sender_id: currentUserId,
    text: text,
    created_at: currentTime,
    attachments: attachments.map((url) => ({ type: 'image', url })),
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
    attachments,
  };

  res.json(response);
};
