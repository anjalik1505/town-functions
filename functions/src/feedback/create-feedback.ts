import { Request } from 'express';
import { DocumentData, getFirestore, Timestamp, UpdateData } from 'firebase-admin/firestore';
import { v4 as uuidv4 } from 'uuid';
import { ApiResponse, EventName, FeedbackEventParams } from '../models/analytics-events.js';
import { Collections } from '../models/constants.js';
import { CreateFeedbackPayload, Feedback } from '../models/data-models.js';
import { getLogger } from '../utils/logging-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Creates a new feedback entry from the current user.
 *
 * This function creates a new feedback document in the Firestore database with the content
 * provided in the request.
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: The validated request data containing:
 *                - content: The text content of the feedback
 *
 * @returns An ApiResponse containing the created feedback and analytics
 */
export const createFeedback = async (req: Request): Promise<ApiResponse<Feedback>> => {
  logger.info(`Creating feedback for user: ${req.userId}`);

  // Get the authenticated user ID from the request
  const currentUserId = req.userId;

  // Get validated data from the request
  const validatedParams = req.validated_params as CreateFeedbackPayload;
  const content = validatedParams.content;

  logger.info(`Feedback details - content length: ${content.length}`);

  // Initialize Firestore client
  const db = getFirestore();

  // Generate a unique ID for the feedback
  const feedbackId = uuidv4();

  // Get current timestamp
  const createdAt = Timestamp.now();

  // Create the feedback document
  const feedbackData: UpdateData<DocumentData> = {
    created_by: currentUserId,
    content: content,
    created_at: createdAt,
  };

  // Save the feedback to Firestore
  await db.collection(Collections.FEEDBACK).doc(feedbackId).set(feedbackData);
  logger.info(`Successfully created feedback with ID: ${feedbackId}`);

  // Return the created feedback
  const response: Feedback = {
    feedback_id: feedbackId,
    created_by: currentUserId,
    content: content,
    created_at: formatTimestamp(createdAt),
  };

  // Create analytics event
  const event: FeedbackEventParams = {
    feedback_length: content.length,
  };

  return {
    data: response,
    status: 201,
    analytics: {
      event: EventName.FEEDBACK_CREATED,
      userId: currentUserId,
      params: event,
    },
  };
};
