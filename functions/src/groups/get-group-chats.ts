import { Request, Response } from 'express';
import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { Collections, QueryOperators } from '../models/constants.js';
import { ChatDoc, chatConverter, chf } from '../models/firestore/chat-doc.js';
import { ChatMessage, ChatResponse, PaginationPayload } from '../models/data-models.js';
import { groupConverter } from '../models/firestore/index.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { applyPagination, generateNextCursor, processQueryStream } from '../utils/pagination-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

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
 *                - after_cursor: Cursor for pagination (base64 encoded document path)
 * @param res - The Express response object
 * @param groupId - The ID of the group to retrieve chat messages for
 *
 * Query Parameters:
 * - limit: Maximum number of messages to return (default: 20, min: 1, max: 100)
 * - after_cursor: Cursor for pagination (base64 encoded document path)
 *
 * @returns A ChatResponse containing:
 * - A list of chat messages for the specified group
 * - A next_cursor for pagination (if more results are available)
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
  const validatedParams = req.validated_params as PaginationPayload;
  const limit = validatedParams?.limit || 20;
  const afterCursor = validatedParams?.after_cursor;

  logger.info(`Pagination parameters - limit: ${limit}, after_cursor: ${afterCursor}`);

  // First, check if the group exists and if the user is a member
  const groups = db.collection(Collections.GROUPS).withConverter(groupConverter);
  const groupRef = groups.doc(groupId);
  const groupDoc = await groupRef.get();

  const groupData = groupDoc.data();
  if (!groupData) {
    logger.warn(`Group ${groupId} not found`);
    throw new NotFoundError('Group not found');
  }

  const members = groupData.members || [];

  // Check if the current user is a member of the group
  if (!members.includes(currentUserId)) {
    logger.warn(`User ${currentUserId} is not a member of group ${groupId}`);
    throw new ForbiddenError('You must be a member of the group to view its chat messages');
  }

  // Set up the query for chat messages
  // Note: we need to use the raw document reference for subcollections
  const rawGroupRef = db.collection(Collections.GROUPS).doc(groupId);
  const chatsRef = rawGroupRef.collection(Collections.CHATS).withConverter(chatConverter);

  // Build the query: first ordering, then pagination, then limit
  let query = chatsRef.orderBy(chf('created_at'), QueryOperators.DESC);

  // Apply cursor-based pagination - Express will automatically catch errors
  const paginatedQuery = await applyPagination(query, afterCursor, limit);

  // Process chat messages using streaming
  const { items: chatDocs, lastDoc } = await processQueryStream<QueryDocumentSnapshot>(
    paginatedQuery,
    (doc) => doc,
    limit,
  );

  // Convert Firestore documents to ChatMessage models
  const messages: ChatMessage[] = chatDocs.map((chatDoc) => {
    const docData = chatDoc.data() as ChatDoc;
    const message: ChatMessage = {
      message_id: chatDoc.id,
      sender_id: docData.sender_id || '',
      text: docData.text || '',
      created_at: docData.created_at ? formatTimestamp(docData.created_at) : '',
      attachments: docData.attachments?.map((att) => att.url || att.type) || [],
    };
    return message;
  });

  logger.info('Query executed successfully');

  // Set up pagination for the next request
  const nextCursor = generateNextCursor(lastDoc, messages.length, limit);

  logger.info(`Retrieved ${messages.length} chat messages for group: ${groupId}`);

  // Return the response
  const response: ChatResponse = {
    messages,
    next_cursor: nextCursor,
  };

  res.json(response);
};
