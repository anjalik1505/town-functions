import { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FirestoreEvent } from 'firebase-functions/v2/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventName, NotificationEventParams } from '../models/analytics-events.js';
import { UpdateDoc } from '../models/firestore/update-doc.js';
import { NotificationService } from '../services/notification-service.js';
import { UpdateService } from '../services/update-service.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Firestore trigger function that runs when a new update is created.
 * Uses the orchestration pattern with UpdateService for notification preparation.
 *
 * @param event - The Firestore event object containing the document data
 */
export const onUpdateNotification = async (
  event: FirestoreEvent<
    QueryDocumentSnapshot | undefined,
    {
      id: string;
    }
  >,
): Promise<void> => {
  try {
    const updateSnapshot = event.data;

    if (!updateSnapshot) {
      logger.error('No update data in event');
      return;
    }

    // Convert to typed document
    const updateData = updateSnapshot.data() as UpdateDoc;

    if (!updateData) {
      logger.error('Update data is null');
      return;
    }

    // Add the ID from the document snapshot
    const updateId = event.params.id;
    const updateWithId = { ...updateData, id: updateId };

    logger.info(`Processing update notification: ${updateId}`);

    const creatorId = updateData.created_by;
    if (!creatorId) {
      logger.error(`No creator ID found for update ${updateId}`);
      return;
    }

    // Initialize UpdateService and NotificationService
    const updateService = new UpdateService();
    const notificationService = new NotificationService();

    // Prepare notification data using the orchestration pattern
    const notificationData = await updateService.prepareUpdateNotifications(updateWithId);

    let totalNotificationResult: NotificationEventParams = {
      notification_all: false,
      notification_urgent: false,
      no_notification: true,
      no_device: false,
      notification_length: 0,
      is_urgent: false,
    };

    // Process all notifications
    for (const notification of notificationData.notifications) {
      try {
        const result = await notificationService.sendNotification(
          notification.userIds,
          notification.title,
          notification.message,
          notification.data,
        );

        // Merge analytics results
        totalNotificationResult.notification_all ||= result.notification_all;
        totalNotificationResult.no_notification &&= result.no_notification;
        totalNotificationResult.no_device ||= result.no_device;
        totalNotificationResult.notification_length = Math.max(
          totalNotificationResult.notification_length,
          result.notification_length,
        );

        logger.info(`Sent notification to ${notification.userIds.length} users`);
      } catch (error) {
        logger.error(`Failed to send update notification to ${notification.userIds.length} users`, error);
        totalNotificationResult.no_device = true;
      }
    }

    // Process all background notifications
    for (const backgroundNotification of notificationData.backgroundNotifications) {
      try {
        await notificationService.sendBackgroundNotification(
          backgroundNotification.userIds,
          backgroundNotification.data,
        );

        logger.info(`Sent background notification to ${backgroundNotification.userIds.length} users`);
      } catch (error) {
        logger.error(`Failed to send background notification to ${backgroundNotification.userIds.length} users`, error);
      }
    }

    // Track analytics using the merged notification results
    const analyticsParams: NotificationEventParams = totalNotificationResult;

    await trackApiEvents(
      [
        {
          eventName: EventName.NOTIFICATION_SENT,
          params: analyticsParams,
        },
      ],
      creatorId,
    );

    logger.info(`Successfully processed update notification for update ${updateId}`);
  } catch (error) {
    logger.error(`Error processing update notification:`, error);
  }
};
