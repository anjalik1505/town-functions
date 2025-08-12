import { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FirestoreEvent } from 'firebase-functions/v2/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventName, NotificationEventParams } from '../models/analytics-events.js';
import { NotificationTypes } from '../models/constants.js';
import { ReactionDoc } from '../models/firestore/index.js';
import { UpdateNotificationService } from '../services/index.js';
import { NotificationService } from '../services/notification-service.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Firestore trigger function that runs when a new reaction is created.
 * Uses the orchestration pattern with UpdateService for notification preparation.
 *
 * @param event - The Firestore event object containing the document data
 */
export const onReactionCreated = async (
  event: FirestoreEvent<
    QueryDocumentSnapshot | undefined,
    {
      updateId: string;
      reactionId: string;
    }
  >,
): Promise<void> => {
  try {
    const reactionSnapshot = event.data;

    if (!reactionSnapshot) {
      logger.error('No reaction data in event');
      return;
    }

    // Convert to typed document
    const reactionData = reactionSnapshot.data() as ReactionDoc;

    if (!reactionData) {
      logger.error('Reaction data is null');
      return;
    }

    // Extract IDs from parameter names
    const updateId = event.params.updateId;
    const reactorId = event.params.reactionId; // Document ID is the userId

    // Get the reaction types array from the document
    const reactionTypes = reactionData.types || [];
    if (reactionTypes.length === 0) {
      logger.warn(`No reaction types found in reaction document for user ${reactorId}`);
      return;
    }

    logger.info(
      `Processing reaction creation: user ${reactorId} on update ${updateId} with types ${reactionTypes.join(', ')}`,
    );

    // Initialize UpdateService and NotificationService
    const notificationService = new NotificationService();
    const updateNotificationService = new UpdateNotificationService();

    // Prepare notification data using the orchestration pattern
    const notificationData = await updateNotificationService.prepareReactionNotifications(
      updateId,
      reactionData,
      reactorId,
    );

    let notificationResult: NotificationEventParams = {
      notification_all: false,
      notification_urgent: false,
      no_notification: true,
      no_device: false,
      notification_length: 0,
      is_urgent: false,
    };

    // Process update creator notification if it exists
    if (notificationData.updateCreatorNotification) {
      try {
        const creatorResult = await notificationService.sendNotification(
          [notificationData.updateCreatorNotification.userId],
          notificationData.updateCreatorNotification.title,
          notificationData.updateCreatorNotification.message,
          notificationData.updateCreatorNotification.data,
        );

        // Also send background notification
        await notificationService.sendBackgroundNotification([notificationData.updateCreatorNotification.userId], {
          type: NotificationTypes.REACTION_BACKGROUND,
          update_id: updateId,
        });

        // Use the creator result as our notification result
        notificationResult = creatorResult;

        logger.info(`Sent notification to update creator ${notificationData.updateCreatorNotification.userId}`);
      } catch (error) {
        logger.error(
          `Failed to send reaction notification to update creator ${notificationData.updateCreatorNotification.userId}`,
          error,
        );
        notificationResult.no_device = true;
      }
    }

    // Track analytics using the notification results
    await trackApiEvents(
      [
        {
          eventName: EventName.REACTION_NOTIFICATION_SENT,
          params: notificationResult,
        },
      ],
      reactorId,
    );

    logger.info(`Successfully processed reaction notification for user ${reactorId} on update ${updateId}`);
  } catch (error) {
    logger.error(`Error processing reaction notification:`, error);
  }
};
