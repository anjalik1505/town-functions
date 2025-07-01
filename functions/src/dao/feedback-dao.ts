import { BaseDAO } from './base-dao.js';
import { FeedbackDoc, feedbackConverter } from '../models/firestore/index.js';
import { Collections } from '../models/constants.js';

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
}
