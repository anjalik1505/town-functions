import { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FirestoreEvent } from 'firebase-functions/v2/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventName, NotificationEventParams } from '../models/analytics-events.js';
import { NotificationTypes } from '../models/constants.js';
import { CommentDoc, cf } from '../models/firestore/index.js';
import { UpdateNotificationService } from '../services/index.js';
import { NotificationService } from '../services/notification-service.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Firestore trigger function that runs when a new comment is created.
 * Uses the orchestration pattern with UpdateService for notification preparation.
 *
 * @param event - The Firestore event object containing the document data
 */
export const onCommentCreated = async (
  event: FirestoreEvent<
    QueryDocumentSnapshot | undefined,
    {
      updateId: string;
      commentId: string;
    }
  >,
): Promise<void> => {
  try {
    const commentSnapshot = event.data;

    if (!commentSnapshot) {
      logger.error('No comment data in event');
      return;
    }

    // Convert to typed document
    const commentData = commentSnapshot.data() as CommentDoc;

    if (!commentData) {
      logger.error('Comment data is null');
      return;
    }

    // Extract IDs from new parameter names
    const updateId = event.params.updateId;
    const commentId = event.params.commentId;

    logger.info(`Processing comment creation: ${commentId} on update ${updateId}`);

    const commenterId = commentData[cf('created_by')];
    if (!commenterId) {
      logger.error(`No creator ID found for comment ${commentId}`);
      return;
    }

    // Initialize UpdateService and NotificationService
    const notificationService = new NotificationService();
    const updateNotificationService = new UpdateNotificationService();

    // Prepare notification data using the orchestration pattern
    const notificationData = await updateNotificationService.prepareCommentNotifications(
      updateId,
      commentData,
      commenterId,
    );

    let totalNotificationResult: NotificationEventParams = {
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
          type: NotificationTypes.COMMENT_BACKGROUND,
          update_id: updateId,
        });

        // Merge analytics results
        totalNotificationResult.notification_all ||= creatorResult.notification_all;
        totalNotificationResult.no_notification &&= creatorResult.no_notification;
        totalNotificationResult.no_device ||= creatorResult.no_device;
        totalNotificationResult.notification_length = Math.max(
          totalNotificationResult.notification_length,
          creatorResult.notification_length,
        );

        logger.info(`Sent notification to update creator ${notificationData.updateCreatorNotification.userId}`);
      } catch (error) {
        logger.error(
          `Failed to send comment notification to update creator ${notificationData.updateCreatorNotification.userId}`,
          error,
        );
        totalNotificationResult.no_device = true;
      }
    }

    // Process participant notifications
    if (notificationData.participantNotifications) {
      try {
        const participantResult = await notificationService.sendNotification(
          notificationData.participantNotifications.userIds,
          notificationData.participantNotifications.title,
          notificationData.participantNotifications.message,
          notificationData.participantNotifications.data,
        );

        // Also send background notification
        await notificationService.sendBackgroundNotification(notificationData.participantNotifications.userIds, {
          type: NotificationTypes.COMMENT_BACKGROUND,
          update_id: updateId,
        });

        // Merge analytics results
        totalNotificationResult.notification_all ||= participantResult.notification_all;
        totalNotificationResult.no_notification &&= participantResult.no_notification;
        totalNotificationResult.no_device ||= participantResult.no_device;
        totalNotificationResult.notification_length = Math.max(
          totalNotificationResult.notification_length,
          participantResult.notification_length,
        );

        logger.info(`Sent notification to ${notificationData.participantNotifications.userIds.length} participants`);
      } catch (error) {
        logger.error(`Failed to send comment notification to participants`, error);
        totalNotificationResult.no_device = true;
      }
    }

    // Track analytics using the merged notification results
    const analyticsParams: NotificationEventParams = totalNotificationResult;

    await trackApiEvents(
      [
        {
          eventName: EventName.COMMENT_NOTIFICATION_SENT,
          params: analyticsParams,
        },
      ],
      commenterId,
    );

    logger.info(`Successfully processed comment notification for comment ${commentId}`);
  } catch (error) {
    logger.error(`Error processing comment notification:`, error);
  }
};
