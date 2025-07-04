import { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FirestoreEvent } from 'firebase-functions/v2/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { FriendDoc } from '../models/firestore/friend-doc.js';
import { FriendshipService } from '../services/friendship-service.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Firestore trigger function that runs when a new friend document is created.
 * This function uses context detection to determine how to handle the friend document:
 *
 * - context: 'migration' -> Skip processing (migration from old system)
 * - context: 'join_request_accepted' -> Handle join request acceptance with notifications
 * - no context -> Handle as generic friendship creation
 *
 * @param event - The Firestore event object containing the document data
 */
export const onFriendshipCreated = async (
  event: FirestoreEvent<
    QueryDocumentSnapshot | undefined,
    {
      userId: string;
      friendId: string;
    }
  >,
): Promise<void> => {
  if (!event.data) {
    logger.error('No data in friend event');
    return;
  }

  const userId = event.params.userId; // Owner of the subcollection
  const friendId = event.params.friendId; // Document ID in subcollection
  const friendDocData = event.data.data() as FriendDoc;
  const accepterId = friendDocData.accepter_id;

  logger.info(`Processing friend document creation: ${userId}/${friendId}`);

  // Only process from the "primary" user (lexicographically smaller ID) to avoid duplicate work
  const primaryUserId = [userId, friendId].sort()[0];
  if (userId !== primaryUserId) {
    logger.info(`Skipping friendship processing - not primary user (${userId} vs ${primaryUserId})`);
    return;
  }

  logger.info(`Processing friendship creation from primary user ${userId} with friend ${friendId}`);

  // Use FriendshipService to handle the friendship creation
  const friendshipService = new FriendshipService();

  try {
    await friendshipService.processFriendshipCreation(userId, friendId, accepterId);
  } catch (error) {
    logger.error(`Failed to process friendship creation ${userId}/${friendId}`, error);
  }
};
