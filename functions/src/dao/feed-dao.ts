import { Timestamp, WriteBatch } from 'firebase-admin/firestore';
import { Collections, QueryOperators } from '../models/constants.js';
import { FeedDoc, fdf, feedConverter } from '../models/firestore/index.js';
import { getLogger } from '../utils/logging-utils.js';
import { applyPagination, generateNextCursor, processQueryStream } from '../utils/pagination-utils.js';
import { BaseDAO } from './base-dao.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Data Access Object for Feed documents in user_feeds/{userId}/feed subcollection
 * Manages user feed items with batch fanout and pagination
 */
export class FeedDAO extends BaseDAO<FeedDoc> {
  constructor() {
    super(Collections.USER_FEEDS, feedConverter, Collections.FEED);
  }

  /**
   * Creates feed items for multiple users (batch fanout)
   * @param feedItems Array of feed items to create with their target user IDs
   * @param batch Optional batch to include this operation in
   * @returns Array of created feed items with their IDs
   */
  async createFeedItems(
    feedItems: Array<{
      userId: string;
      updateId: string;
      createdAt: Timestamp;
      directVisible: boolean;
      friendId?: string | null;
      groupIds: string[];
      createdBy: string;
    }>,
    batch?: WriteBatch,
  ): Promise<void> {
    const shouldCommitBatch = !batch;
    const workingBatch = batch || this.db.batch();

    feedItems.forEach((item) => {
      const feedRef = this.db
        .collection(this.collection)
        .doc(item.userId)
        .collection(this.subcollection!)
        .withConverter(this.converter)
        .doc();

      const feedData: FeedDoc = {
        update_id: item.updateId,
        created_at: item.createdAt,
        direct_visible: item.directVisible,
        friend_id: item.friendId || '',
        group_ids: item.groupIds,
        created_by: item.createdBy,
      };

      workingBatch.set(feedRef, feedData);
    });

    if (shouldCommitBatch) {
      await workingBatch.commit();
    }

    logger.info(`Created ${feedItems.length} feed items`);
  }

  /**
   * Batch creates feed items using utility function pattern
   * Determines visibility for each user and creates appropriate feed items
   * @param usersToNotify Set of user IDs who should see the update
   * @param updateId The update ID
   * @param createdAt The timestamp when the update was created
   * @param createdBy The user ID who created the update
   * @param friendIds Array of friend IDs the update was shared with
   * @param groupIds Array of group IDs the update was shared with
   * @param groupMembersMap Map of group IDs to their member sets
   * @param batch Optional batch to include this operation in
   */
  async createFeedItemsForUpdate(
    usersToNotify: Set<string>,
    updateId: string,
    createdAt: Timestamp,
    createdBy: string,
    friendIds: string[],
    groupIds: string[],
    groupMembersMap: Map<string, Set<string>>,
    batch?: WriteBatch,
  ): Promise<void> {
    const feedItems: Array<{
      userId: string;
      updateId: string;
      createdAt: Timestamp;
      directVisible: boolean;
      friendId?: string | null;
      groupIds: string[];
      createdBy: string;
    }> = [];

    // Create feed items for each user
    Array.from(usersToNotify).forEach((userId) => {
      // Determine how this user can see the update
      const isDirectFriend = userId === createdBy || friendIds.includes(userId);
      const userGroups = groupIds.filter((groupId: string) => groupMembersMap.get(groupId)?.has(userId));

      feedItems.push({
        userId,
        updateId,
        createdAt,
        directVisible: isDirectFriend,
        friendId: isDirectFriend ? createdBy : null,
        groupIds: userGroups,
        createdBy,
      });
    });

    await this.createFeedItems(feedItems, batch);
  }

  /**
   * Gets a user's own updates from their feed
   * @param userId The user ID
   * @param afterCursor Optional cursor for pagination
   * @param limit Maximum number of items to return
   * @returns Paginated feed items and next cursor
   */
  async getUserOwnFeed(
    userId: string,
    afterCursor?: string,
    limit: number = 20,
  ): Promise<{ feedItems: FeedDoc[]; nextCursor: string | null }> {
    const query = this.db
      .collection(this.collection)
      .doc(userId)
      .collection(this.subcollection!)
      .withConverter(this.converter)
      .where(fdf('created_by'), QueryOperators.EQUALS, userId)
      .orderBy(fdf('created_at'), QueryOperators.DESC);

    // Apply pagination
    const paginatedQuery = await applyPagination(query, afterCursor, limit);

    // Process the query stream
    const { items, lastDoc } = await processQueryStream(paginatedQuery, (doc) => doc.data()! as FeedDoc, limit);

    // Generate next cursor
    const nextCursor = generateNextCursor(lastDoc, items.length, limit);

    return {
      feedItems: items,
      nextCursor,
    };
  }

  /**
   * Gets a user's full feed (all updates visible to them)
   * @param userId The user ID
   * @param afterCursor Optional cursor for pagination
   * @param limit Maximum number of items to return
   * @returns Paginated feed items and next cursor
   */
  async getUserFullFeed(
    userId: string,
    afterCursor?: string,
    limit: number = 20,
  ): Promise<{ feedItems: FeedDoc[]; nextCursor: string | null }> {
    const query = this.db
      .collection(this.collection)
      .doc(userId)
      .collection(this.subcollection!)
      .withConverter(this.converter)
      .orderBy(fdf('created_at'), QueryOperators.DESC);

    // Apply pagination
    const paginatedQuery = await applyPagination(query, afterCursor, limit);

    // Process the query stream
    const { items, lastDoc } = await processQueryStream(paginatedQuery, (doc) => doc.data()! as FeedDoc, limit);

    // Generate next cursor
    const nextCursor = generateNextCursor(lastDoc, items.length, limit);

    return {
      feedItems: items,
      nextCursor,
    };
  }

  /**
   * Gets updates from a specific friend in the user's feed
   * @param userId The user whose feed to query
   * @param friendId The friend whose updates to filter by
   * @param afterCursor Optional cursor for pagination
   * @param limit Maximum number of items to return
   * @returns Paginated feed items and next cursor
   */
  async getUserFriendFeed(
    userId: string,
    friendId: string,
    afterCursor?: string,
    limit: number = 20,
  ): Promise<{ feedItems: FeedDoc[]; nextCursor: string | null }> {
    const query = this.db
      .collection(this.collection)
      .doc(userId)
      .collection(this.subcollection!)
      .withConverter(this.converter)
      .where(fdf('created_by'), QueryOperators.EQUALS, friendId)
      .orderBy(fdf('created_at'), QueryOperators.DESC);

    // Apply pagination
    const paginatedQuery = await applyPagination(query, afterCursor, limit);

    // Process the query stream
    const { items, lastDoc } = await processQueryStream(paginatedQuery, (doc) => doc.data()! as FeedDoc, limit);

    // Generate next cursor
    const nextCursor = generateNextCursor(lastDoc, items.length, limit);

    return {
      feedItems: items,
      nextCursor,
    };
  }
}
