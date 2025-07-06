import path from 'path';
import { fileURLToPath } from 'url';
import {
  EventName,
  InvitationNotificationEventParams,
  InvitationNotificationsEventParams,
} from '../models/analytics-events.js';
import { SYSTEM_USER } from '../models/constants.js';
import { InvitationService } from '../services/invitation-service.js';
import { NotificationService } from '../services/notification-service.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Process no-friends notifications for all eligible users.
 * This function is scheduled to run every three days.
 * Uses service orchestration pattern for better maintainability.
 */
export const processInvitationNotifications = async (): Promise<void> => {
  logger.info('Starting no-friends notification processing');

  try {
    // Initialize services
    const invitationService = new InvitationService();
    const notificationService = new NotificationService();

    // Get all notification data from InvitationService
    const { notifications, analyticsResults } = await invitationService.prepareNoFriendsNotifications();

    logger.info(`Processing ${notifications.length} notifications for ${analyticsResults.length} users`);

    // Send notifications and update analytics results with device status
    const updatedResults: InvitationNotificationEventParams[] = analyticsResults.map(({ ...result }) => ({
      has_friends: result.has_friends,
      has_timestamp: result.has_timestamp,
      profile_too_new: result.profile_too_new,
      has_device: result.has_device,
    }));

    // Send notifications for eligible users
    for (const notification of notifications) {
      try {
        // Send notification using NotificationService
        const notificationResult = await notificationService.sendNotification(
          [notification.userId],
          notification.title,
          notification.message,
          notification.data,
        );

        // Find the corresponding analytics result and update device status
        const resultIndex = analyticsResults.findIndex((result) => result.userId === notification.userId);
        if (resultIndex !== -1) {
          const currentResult = updatedResults[resultIndex]!;
          updatedResults[resultIndex] = {
            has_friends: currentResult.has_friends,
            has_timestamp: currentResult.has_timestamp,
            profile_too_new: currentResult.profile_too_new,
            has_device: !notificationResult.no_device,
          };
        }

        if (notificationResult.notification_all) {
          logger.info(`Successfully sent no-friends notification to user ${notification.userId}`);
        } else {
          logger.warn(
            `Failed to send no-friends notification to user ${notification.userId} - no device or notification failed`,
          );
        }
      } catch (error) {
        logger.error(`Failed to send notification to user ${notification.userId}`, error);
        // Update corresponding analytics result to mark as no device
        const resultIndex = analyticsResults.findIndex((result) => result.userId === notification.userId);
        if (resultIndex !== -1) {
          const currentResult = updatedResults[resultIndex]!;
          updatedResults[resultIndex] = {
            has_friends: currentResult.has_friends,
            has_timestamp: currentResult.has_timestamp,
            profile_too_new: currentResult.profile_too_new,
            has_device: false,
          };
        }
      }
    }

    // Aggregate analytics data
    const totalUsers = updatedResults.length;
    const notifiedCount = updatedResults.filter(
      (r) => !r.has_friends && r.has_timestamp && !r.profile_too_new && r.has_device,
    ).length;
    const hasFriendsCount = updatedResults.filter((r) => r.has_friends).length;
    const noTimestampCount = updatedResults.filter((r) => !r.has_timestamp).length;
    const profileTooNewCount = updatedResults.filter((r) => r.profile_too_new).length;
    const noDeviceCount = updatedResults.filter((r) => !r.has_device).length;

    // Create aggregate event
    const noFriendsNotifications: InvitationNotificationsEventParams = {
      total_users_count: totalUsers,
      notified_count: notifiedCount,
      has_friends_count: hasFriendsCount,
      no_timestamp_count: noTimestampCount,
      profile_too_new_count: profileTooNewCount,
      no_device_count: noDeviceCount,
    };

    // Track all events at once using the new pattern
    const events = [
      {
        eventName: EventName.INVITATION_NOTIFICATIONS_SENT,
        params: noFriendsNotifications,
      },
      ...updatedResults.map((result) => ({
        eventName: EventName.INVITATION_NOTIFICATION_SENT,
        params: result,
      })),
    ];

    await trackApiEvents(events, SYSTEM_USER);
    logger.info(`Tracked ${events.length} analytics events`);

    logger.info(
      `Completed no-friends notification processing: ${notifications.length} notifications sent to eligible users out of ${totalUsers} total users`,
    );
  } catch (error) {
    logger.error('Error in processInvitationNotifications:', error);
    throw error;
  }
};
