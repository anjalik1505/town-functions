import { Query, Timestamp } from 'firebase-admin/firestore';
import { Collections, QueryOperators } from '../models/constants.js';
import { FriendDoc, ff, friendConverter } from '../models/firestore/friend-doc.js';
import { applyPagination, generateNextCursor, processQueryStream } from '../utils/pagination-utils.js';
import { BaseDAO } from './base-dao.js';

const FRIEND_LIMIT = 20;

/**
 * Data Access Object for managing friends subcollection under profiles
 * Handles friendship operations and synchronization
 */
export class FriendshipDAO extends BaseDAO<FriendDoc> {
  constructor() {
    super(Collections.PROFILES, friendConverter, Collections.FRIENDS);
  }

  /**
   * Gets a friend document reference with converter
   */
  private getFriendDocRef(userId: string, friendId: string): FirebaseFirestore.DocumentReference<FriendDoc> {
    return this.db
      .collection(this.collection)
      .doc(userId)
      .collection(this.subcollection!)
      .withConverter(this.converter)
      .doc(friendId);
  }

  /**
   * Gets a specific friend document
   */
  async getFriend(userId: string, friendId: string): Promise<FriendDoc | null> {
    const friendRef = this.getFriendDocRef(userId, friendId);
    const friendDoc = await friendRef.get();

    return friendDoc.exists ? (friendDoc.data() ?? null) : null;
  }

  /**
   * Checks if two users are friends
   */
  async areFriends(userId: string, friendId: string): Promise<boolean> {
    const friend = await this.getFriend(userId, friendId);
    return friend !== null;
  }

  /**
   * Upserts a friend document with the given data
   * @returns The complete friend document
   */
  async upsertFriend(
    userId: string,
    friendId: string,
    friendData: Partial<FriendDoc>,
    batch?: FirebaseFirestore.WriteBatch,
  ): Promise<FriendDoc> {
    const friendRef = this.getFriendDocRef(userId, friendId);
    const now = Timestamp.now();

    // Get existing document to merge data
    const existingDoc = await friendRef.get();
    const existingData = existingDoc.exists ? existingDoc.data() : null;

    const payload: Partial<FriendDoc> = {
      ...friendData,
      updated_at: now,
    };

    // Set created_at only if this is a new document
    if (!existingDoc.exists) {
      payload.created_at = now;
    }

    const write = (b: FirebaseFirestore.WriteBatch) => {
      b.set(friendRef, payload as FriendDoc, { merge: true });
    };

    if (batch) {
      write(batch);
    } else {
      const b = this.db.batch();
      write(b);
      await b.commit();
    }

    // Return the merged document
    const mergedData: FriendDoc = {
      username: friendData.username ?? existingData?.username ?? '',
      name: friendData.name ?? existingData?.name ?? '',
      avatar: friendData.avatar ?? existingData?.avatar ?? '',
      last_update_emoji: friendData.last_update_emoji ?? existingData?.last_update_emoji ?? '',
      last_update_at: friendData.last_update_at ?? existingData?.last_update_at ?? now,
      created_at: existingData?.created_at ?? now,
      updated_at: now,
      accepter_id: existingData?.accepter_id ?? friendData.accepter_id ?? '',
    };

    return mergedData;
  }

  /**
   * Gets friends with pagination and streaming support
   */
  async getFriends(
    userId: string,
    limit: number = 20,
    afterCursor?: string,
  ): Promise<{ friends: (FriendDoc & { userId: string })[]; nextCursor: string | null }> {
    let query: Query = this.db
      .collection(this.collection)
      .doc(userId)
      .collection(this.subcollection!)
      .withConverter(this.converter)
      .orderBy(ff('created_at'), QueryOperators.DESC);

    // Apply pagination
    query = await applyPagination(query, afterCursor, limit);

    // Use streaming for memory efficiency with large datasets
    const { items, lastDoc } = await processQueryStream(
      query,
      (doc) => ({ ...(doc.data()! as FriendDoc), userId: doc.id }),
      limit,
    );

    const nextCursor = generateNextCursor(lastDoc, items.length, limit);
    return { friends: items, nextCursor };
  }

  /**
   * Checks if a user has reached the friend limit
   */
  async hasReachedLimit(userId: string): Promise<{
    friendCount: number;
    hasReachedLimit: boolean;
  }> {
    const friendsQuery = this.db
      .collection(this.collection)
      .doc(userId)
      .collection(this.subcollection!)
      .withConverter(this.converter);

    const snapshot = await friendsQuery.get();
    const friendCount = snapshot.size;

    return {
      friendCount,
      hasReachedLimit: friendCount >= FRIEND_LIMIT,
    };
  }

  /**
   * Gets all friend IDs for a user (useful for bulk operations)
   */
  async getFriendIds(userId: string): Promise<string[]> {
    const friendsQuery = this.db
      .collection(this.collection)
      .doc(userId)
      .collection(this.subcollection!)
      .withConverter(this.converter);

    const snapshot = await friendsQuery.get();
    return snapshot.docs.map((doc) => doc.id);
  }

  /**
   * Batch deletes multiple friends
   */
  async deleteFriends(userId: string, friendIds: string[]): Promise<void> {
    if (friendIds.length === 0) return;

    const batch = this.db.batch();

    friendIds.forEach((friendId) => {
      const friendRef = this.getFriendDocRef(userId, friendId);
      batch.delete(friendRef);
    });

    await batch.commit();
  }

  /**
   * Removes a bidirectional friendship between two users
   */
  async removeFriendship(userId: string, friendId: string, batch?: FirebaseFirestore.WriteBatch): Promise<void> {
    // If batch is provided, add operations to it
    if (batch) {
      this.deleteFriendDocuments(userId, friendId, batch);
    } else {
      // Create and commit a new batch
      const newBatch = this.db.batch();
      this.deleteFriendDocuments(userId, friendId, newBatch);
      await newBatch.commit();
    }
  }

  /**
   * Deletes friend documents bidirectionally
   * Only handles friend document deletion, no profile updates
   */
  deleteFriendDocuments(userId: string, friendId: string, batch: FirebaseFirestore.WriteBatch): void {
    // Delete friend documents
    const userFriendRef = this.getFriendDocRef(userId, friendId);
    const friendUserRef = this.getFriendDocRef(friendId, userId);

    batch.delete(userFriendRef);
    batch.delete(friendUserRef);
  }
}
