import { Timestamp, WriteBatch } from 'firebase-admin/firestore';
import { Collections } from '../models/constants.js';
import { feedConverter, FeedDoc } from '../models/firestore/index.js';
import { getLogger } from './logging-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Create a feed item for a user
 *
 * @param db - Firestore client
 * @param batch - Firestore write batch
 * @param userId - The ID of the user who will see the feed item
 * @param updateId - The ID of the update
 * @param createdAt - The timestamp when the update was created
 * @param isDirectFriend - Whether the user is directly connected to the creator
 * @param friendId - The ID of the friend who created the update (or null if not a direct friend)
 * @param groupIds - Array of group IDs through which the user can see the update
 * @param createdBy - The ID of the user who created the update
 */
export const createFeedItem = (
  db: FirebaseFirestore.Firestore,
  batch: WriteBatch,
  userId: string,
  updateId: string,
  createdAt: Timestamp,
  isDirectFriend: boolean,
  friendId: string | null,
  groupIds: string[],
  createdBy: string,
): void => {
  const feedItemRef = db
    .collection(Collections.USER_FEEDS)
    .doc(userId)
    .collection(Collections.FEED)
    .withConverter(feedConverter)
    .doc(updateId);

  const feedItemData: FeedDoc = {
    update_id: updateId,
    created_at: createdAt,
    direct_visible: isDirectFriend,
    friend_id: friendId ?? '',
    group_ids: groupIds,
    created_by: createdBy,
  };

  batch.set(feedItemRef, feedItemData);
  logger.debug(`Added feed item for user ${userId} to batch`);
};
