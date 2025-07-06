import { DocumentReference, Timestamp, WriteBatch } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { Collections, QueryOperators } from '../models/constants.js';
import { userSummaryConverter, UserSummaryDoc, usf } from '../models/firestore/index.js';
import { getLogger } from '../utils/logging-utils.js';
import { createSummaryId } from '../utils/profile-utils.js';
import { BaseDAO } from './base-dao.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Data Access Object for User Summary operations
 * Manages user summaries between friends
 */
export class UserSummaryDAO extends BaseDAO<UserSummaryDoc> {
  constructor() {
    super(Collections.USER_SUMMARIES, userSummaryConverter);
  }

  /**
   * Gets a user summary for a specific relationship
   * @param currentUserId The user viewing the summary
   * @param targetUserId The user whose profile is being viewed
   * @returns The summary if currentUserId is the target, null otherwise
   */
  async getSummary(
    currentUserId: string,
    targetUserId: string,
  ): Promise<{ summary: string; suggestions: string } | null> {
    const summaryId = createSummaryId(currentUserId, targetUserId);
    const summaryRef = this.db.collection(this.collection).withConverter(this.converter).doc(summaryId);

    const summaryDoc = await summaryRef.get();

    if (!summaryDoc.exists) {
      logger.info(`No user summary found for relationship ${currentUserId} <-> ${targetUserId}`);
      return null;
    }

    const summaryData = summaryDoc.data();
    if (!summaryData) {
      return null;
    }

    // Only return summary if current user is the target (the one who should see it)
    if (summaryData.target_id === currentUserId) {
      logger.info(`Retrieved user summary for relationship ${currentUserId} <-> ${targetUserId}`);
      return {
        summary: summaryData.summary || '',
        suggestions: summaryData.suggestions || '',
      };
    }

    logger.info(`User ${currentUserId} is not the target for this summary`);
    return null;
  }

  /**
   * Creates or updates a user summary (used by triggers)
   * @param creatorId The user who created the update
   * @param targetId The user who should see the summary
   * @param data The summary data to update
   * @param batch Optional WriteBatch for batch operations
   */
  async createOrUpdateSummary(
    creatorId: string,
    targetId: string,
    data: {
      summary?: string;
      suggestions?: string;
      lastUpdateId?: string;
      updateCount?: number;
    },
    batch?: WriteBatch,
  ): Promise<void> {
    const summaryId = createSummaryId(creatorId, targetId);
    const summaryRef = this.db.collection(this.collection).withConverter(this.converter).doc(summaryId);

    const updateData: Partial<UserSummaryDoc> = {
      creator_id: creatorId,
      target_id: targetId,
      updated_at: Timestamp.now(),
    };

    if (data.summary !== undefined) {
      updateData.summary = data.summary;
    }

    if (data.suggestions !== undefined) {
      updateData.suggestions = data.suggestions;
    }

    if (data.lastUpdateId !== undefined) {
      updateData.last_update_id = data.lastUpdateId;
    }

    if (data.updateCount !== undefined) {
      updateData.update_count = data.updateCount;
    }

    const existingDoc = await summaryRef.get();
    if (!existingDoc.exists) {
      // Create new document
      const newDoc: UserSummaryDoc = {
        creator_id: creatorId,
        target_id: targetId,
        summary: data.summary || '',
        suggestions: data.suggestions || '',
        last_update_id: data.lastUpdateId || '',
        created_at: Timestamp.now(),
        updated_at: Timestamp.now(),
        update_count: data.updateCount || 0,
      };

      if (batch) {
        batch.set(summaryRef, newDoc);
        logger.info(`Batched creation of new user summary ${summaryId}`);
      } else {
        await summaryRef.set(newDoc);
        logger.info(`Created new user summary ${summaryId}`);
      }
    } else {
      // Update existing document
      if (batch) {
        batch.update(summaryRef, updateData);
        logger.info(`Batched update of user summary ${summaryId}`);
      } else {
        await summaryRef.update(updateData);
        logger.info(`Updated user summary ${summaryId}`);
      }
    }
  }

  /**
   * Gets a user summary document by ID (used internally)
   */
  async get(summaryId: string): Promise<UserSummaryDoc | null> {
    const summaryRef = this.db.collection(this.collection).withConverter(this.converter).doc(summaryId);

    const doc = await summaryRef.get();
    return doc.exists ? doc.data() || null : null;
  }

  /**
   * Streams user summaries where the specified user is the creator
   * @param userId The user ID who created the summaries
   * @returns AsyncIterable of { doc: UserSummaryDoc, ref: DocumentReference }
   */
  async *streamSummariesByCreator(userId: string): AsyncIterable<{ doc: UserSummaryDoc; ref: DocumentReference }> {
    const query = this.db
      .collection(this.collection)
      .withConverter(this.converter)
      .where(usf('creator_id'), QueryOperators.EQUALS, userId);

    const stream = query.stream() as AsyncIterable<FirebaseFirestore.QueryDocumentSnapshot<UserSummaryDoc>>;
    for await (const docSnapshot of stream) {
      const data = docSnapshot.data();
      if (data) {
        yield {
          doc: data,
          ref: docSnapshot.ref,
        };
      }
    }
  }

  /**
   * Streams user summaries where the specified user is the target
   * @param userId The user ID who is the target of the summaries
   * @returns AsyncIterable of { doc: UserSummaryDoc, ref: DocumentReference }
   */
  async *streamSummariesByTarget(userId: string): AsyncIterable<{ doc: UserSummaryDoc; ref: DocumentReference }> {
    const query = this.db
      .collection(this.collection)
      .withConverter(this.converter)
      .where(usf('target_id'), QueryOperators.EQUALS, userId);

    const stream = query.stream() as AsyncIterable<FirebaseFirestore.QueryDocumentSnapshot<UserSummaryDoc>>;
    for await (const docSnapshot of stream) {
      const data = docSnapshot.data();
      if (data) {
        yield {
          doc: data,
          ref: docSnapshot.ref,
        };
      }
    }
  }
}
