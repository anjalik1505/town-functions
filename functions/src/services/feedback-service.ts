import { Timestamp } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { FeedbackDAO } from '../dao/feedback-dao.js';
import { ApiResponse, EventName } from '../models/analytics-events.js';
import { Feedback } from '../models/api-responses.js';
import { FeedbackDoc } from '../models/firestore/index.js';
import { getLogger } from '../utils/logging-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Service layer for Feedback operations
 * Handles user feedback submission
 */
export class FeedbackService {
  private feedbackDAO: FeedbackDAO;

  constructor() {
    this.feedbackDAO = new FeedbackDAO();
  }

  /**
   * Creates feedback from a user
   * @param userId The user ID submitting feedback
   * @param content The feedback content
   * @returns The created Feedback object
   */
  async createFeedback(userId: string, content: string): Promise<ApiResponse<Feedback>> {
    logger.info(`Creating feedback from user ${userId}`, { contentLength: content.length });

    const createdAt = Timestamp.now();
    const feedbackData: FeedbackDoc = {
      created_by: userId,
      content,
      created_at: createdAt,
    };

    const createResult = await this.feedbackDAO.create(feedbackData);

    logger.info(`Successfully created feedback ${createResult.id} from user ${userId}`);

    // Return the full Feedback object
    const feedback: Feedback = {
      feedback_id: createResult.id,
      created_by: userId,
      content: content,
      created_at: formatTimestamp(createdAt),
    };

    return {
      data: feedback,
      status: 201,
      analytics: {
        event: EventName.FEEDBACK_CREATED,
        userId: userId,
        params: {
          feedback_length: content.length,
        },
      },
    };
  }
}
