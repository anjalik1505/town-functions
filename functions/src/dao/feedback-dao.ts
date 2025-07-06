import path from 'path';
import { fileURLToPath } from 'url';
import { BaseDAO } from './base-dao.js';
import { FeedbackDoc, feedbackConverter } from '../models/firestore/index.js';
import { Collections } from '../models/constants.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Data Access Object for Feedback documents
 * Manages feedback collection
 */
export class FeedbackDAO extends BaseDAO<FeedbackDoc> {
  constructor() {
    super(Collections.FEEDBACK, feedbackConverter);
  }

  /**
   * Creates a new feedback entry
   * @param feedbackData The feedback data
   * @returns The created feedback document with ID
   */
  async create(feedbackData: FeedbackDoc): Promise<{ id: string; data: FeedbackDoc }> {
    const feedbackRef = this.db.collection(this.collection).withConverter(this.converter).doc();
    await feedbackRef.set(feedbackData);
    return {
      id: feedbackRef.id,
      data: feedbackData,
    };
  }

  /**
   * Streams all feedback records created by a specific user
   * Used for cleanup operations
   */
  async *streamFeedbackByUserId(userId: string): AsyncGenerator<{ feedbackRef: FirebaseFirestore.DocumentReference }> {
    logger.info(`Streaming feedback by user: ${userId}`);

    const query = this.db.collection(this.collection).where('user_id', '==', userId);

    const snapshot = await query.get();
    for (const doc of snapshot.docs) {
      yield { feedbackRef: doc.ref };
    }
  }
}
