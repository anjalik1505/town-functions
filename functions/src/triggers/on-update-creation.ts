import { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FirestoreEvent } from 'firebase-functions/v2/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventName, NotificationEventParams } from '../models/analytics-events.js';
import { UpdateDoc, uf } from '../models/firestore/index.js';
import { AiService } from '../services/ai-service.js';
import { FriendshipService } from '../services/friendship-service.js';
import { NotificationService } from '../services/notification-service.js';
import { ProfileService } from '../services/profile-service.js';
import { UpdateService } from '../services/update-service.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Firestore trigger function that runs when a new update is created.
 * Uses the orchestration pattern with ProfileService and FriendshipService for AI processing.
 *
 * @param event - The Firestore event object containing the document data
 */
export const onUpdateCreated = async (
  event: FirestoreEvent<
    QueryDocumentSnapshot | undefined,
    {
      updateId: string;
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

    // Add the document ID to the update data
    updateData[uf('id')] = updateSnapshot.id;

    logger.info(`Processing update creation: ${updateSnapshot.id}`);

    const creatorId = updateData[uf('created_by')];
    if (!creatorId) {
      logger.error(`No creator ID found for update ${updateSnapshot.id}`);
      return;
    }

    // Initialize services
    const aiService = new AiService();
    const updateService = new UpdateService();
    const profileService = new ProfileService();
    const friendshipService = new FriendshipService();
    const notificationService = new NotificationService();

    // Update user's last update time in time buckets for notification eligibility
    await profileService.updateUserLastUpdateTime(creatorId, updateData[uf('created_at')]);

    // Process images once and store in update document
    const imagePaths = updateData[uf('image_paths')] || [];
    const imageAnalysis = await aiService.processAndAnalyzeImages(imagePaths);

    // Store image analysis in the update document if we have analysis
    if (imageAnalysis) {
      await updateService.updateImageAnalysis(updateSnapshot.id, imageAnalysis);
    }

    // Process creator profile updates using ProfileService
    const mainSummary = await profileService.processUpdateSimpleProfile(updateData, imageAnalysis);

    // Process friend summaries using FriendshipService
    const friendSummaries = await friendshipService.processUpdateFriendSummaries(updateData, imageAnalysis);

    // Prepare notification data using the orchestration pattern
    const updateWithId = { ...updateData, id: updateSnapshot.id };
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
    if (notificationData.notifications) {
      try {
        const result = await notificationService.sendNotification(
          notificationData.notifications.userIds,
          notificationData.notifications.title,
          notificationData.notifications.message,
          notificationData.notifications.data,
        );

        // Merge analytics results
        totalNotificationResult.notification_all ||= result.notification_all;
        totalNotificationResult.no_notification &&= result.no_notification;
        totalNotificationResult.no_device ||= result.no_device;
        totalNotificationResult.notification_length = Math.max(
          totalNotificationResult.notification_length,
          result.notification_length,
        );

        logger.info(`Sent notification to ${notificationData.notifications.userIds.length} users`);
      } catch (error) {
        logger.error(`Failed to send update notification to users`, error);
        totalNotificationResult.no_device = true;
      }
    }

    // Process all background notifications
    if (notificationData.backgroundNotifications) {
      try {
        await notificationService.sendBackgroundNotification(
          notificationData.backgroundNotifications.userIds,
          notificationData.backgroundNotifications.data,
        );

        logger.info(`Sent background notification to ${notificationData.backgroundNotifications.userIds.length} users`);
      } catch (error) {
        logger.error(`Failed to send background notification to users`, error);
      }
    }

    // Track all analytics events
    const events = [
      {
        eventName: EventName.SUMMARY_CREATED,
        params: mainSummary,
      },
      ...friendSummaries.map((summary) => ({
        eventName: EventName.FRIEND_SUMMARY_CREATED,
        params: summary,
      })),
      {
        eventName: EventName.NOTIFICATION_SENT,
        params: totalNotificationResult,
      },
    ];

    await trackApiEvents(events, creatorId);

    logger.info(`Successfully processed update creation for update ${updateSnapshot.id}`);
  } catch (error) {
    logger.error(`Error processing update creation:`, error);
  }
};
