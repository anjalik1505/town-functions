import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  EventName,
  InvitationNotificationEventParams,
  InvitationNotificationsEventParams,
} from '../models/analytics-events.js';
import { Collections, SYSTEM_USER } from '../models/constants.js';
import { InvitationService } from '../services/invitation-service.js';
import { NotificationService } from '../services/notification-service.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Process notification for a single user with no friends using service orchestration
 */
const processUserNoFriendsNotification = async (
  invitationService: InvitationService,
  notificationService: NotificationService,
  userId: string,
  profileData: FirebaseFirestore.DocumentData,
): Promise<InvitationNotificationEventParams> => {
  try {
    // Use InvitationService to prepare notification data
    const notificationData = await invitationService.prepareNoFriendsNotifications(userId, profileData);

    // If no notification should be sent, return the analytics result
    if (!notificationData.notification) {
      return notificationData.analyticsResult;
    }

    // Send notification using NotificationService
    const notificationResult = await notificationService.sendNotification(
      [notificationData.notification.userId],
      notificationData.notification.title,
      notificationData.notification.message,
      notificationData.notification.data,
    );

    // Update analytics result based on notification success
    const analyticsResult = {
      ...notificationData.analyticsResult,
      has_device: !notificationResult.no_device,
    };

    if (notificationResult.notification_all) {
      logger.info(`Successfully sent no-friends notification to user ${userId}.`);
    } else {
      logger.warn(`Failed to send no-friends notification to user ${userId} - no device or notification failed`);
    }

    return analyticsResult;
  } catch (error) {
    logger.error(`Failed to process no-friends notification for user ${userId}`, error);
    return {
      has_friends: false,
      has_timestamp: false,
      profile_too_new: false,
      has_device: false,
    };
  }
};

/**
 * Process no-friends notifications for all eligible users.
 * This function is scheduled to run every three days.
 * Uses service orchestration pattern for better maintainability.
 */
export const processInvitationNotifications = async (): Promise<void> => {
  logger.info('Starting no-friends notification processing');

  try {
    const db = getFirestore();

    // Initialize services
    const invitationService = new InvitationService();
    const notificationService = new NotificationService();

    // Stream all profiles
    const profilesStream = db.collection(Collections.PROFILES).stream() as AsyncIterable<QueryDocumentSnapshot>;

    // Process all users and collect results
    const results: InvitationNotificationEventParams[] = [];
    for await (const profileDoc of profilesStream) {
      const profileData = profileDoc.data();
      let result: InvitationNotificationEventParams;
      try {
        result = await processUserNoFriendsNotification(
          invitationService,
          notificationService,
          profileDoc.id,
          profileData,
        );
      } catch (error) {
        logger.error(`Failed to process no-friends notification for user ${profileDoc.id}`, error);
        result = {
          has_friends: false,
          has_timestamp: false,
          profile_too_new: false,
          has_device: false,
        };
      }
      results.push(result);
    }

    // Aggregate analytics data
    const totalUsers = results.length;
    const notifiedCount = results.filter(
      (r) => !r.has_friends && r.has_timestamp && !r.profile_too_new && r.has_device,
    ).length;
    const hasFriendsCount = results.filter((r) => r.has_friends).length;
    const noTimestampCount = results.filter((r) => !r.has_timestamp).length;
    const profileTooNewCount = results.filter((r) => r.profile_too_new).length;
    const noDeviceCount = results.filter((r) => !r.has_device).length;

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
      ...results.map((result) => ({
        eventName: EventName.INVITATION_NOTIFICATION_SENT,
        params: result,
      })),
    ];

    await trackApiEvents(events, SYSTEM_USER);
    logger.info(`Tracked ${events.length} analytics events`);

    logger.info('Completed no-friends notification processing');
  } catch (error) {
    logger.error('Error in processInvitationNotifications:', error);
    throw error;
  }
};
