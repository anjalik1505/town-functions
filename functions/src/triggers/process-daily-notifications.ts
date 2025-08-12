import path from 'path';
import { fileURLToPath } from 'url';
import { generateDailyNotificationFlow } from '../ai/flows.js';
import { DailyNotificationsEventParams, EventName, NotificationEventParams } from '../models/analytics-events.js';
import { NotificationTypes, SYSTEM_USER } from '../models/constants.js';
import { ProfileActivityService } from '../services/index.js';
import { NotificationService } from '../services/notification-service.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { calculateAge } from '../utils/profile-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Process hourly notifications using time buckets
 * Uses existing service methods for clean separation of concerns
 */
export const processDailyNotifications = async (): Promise<void> => {
  try {
    logger.info('Starting daily notification processing');

    // Initialize services
    const profileActivityService = new ProfileActivityService();
    const notificationService = new NotificationService();

    // Get all eligible users from current time bucket
    const eligibleUsers = await profileActivityService.getUsersForDailyNotifications();

    if (eligibleUsers.length === 0) {
      logger.info('No eligible users found for daily notifications');
      return;
    }

    logger.info(`Processing daily notifications for ${eligibleUsers.length} users`);

    const results: NotificationEventParams[] = [];

    // Process each user
    for (const user of eligibleUsers) {
      try {
        // Generate personalized notification content using AI
        const aiResult = await generateDailyNotificationFlow({
          name: user.name || user.username || 'Friend',
          gender: user.gender || 'unknown',
          location: user.location || 'unknown',
          age: calculateAge(user.birthday || ''),
        });

        // Send notification using existing notification service
        const result = await notificationService.sendNotification([user.user_id], aiResult.title, aiResult.message, {
          type: NotificationTypes.DAILY,
        });

        results.push(result);
        logger.info(`Sent daily notification to user ${user.user_id}`);
      } catch (error) {
        logger.error(`Failed to send daily notification to user ${user.user_id}`, error);
        // Add failed notification to results for analytics
        results.push({
          notification_all: false,
          notification_urgent: false,
          no_notification: false,
          no_device: false,
          notification_length: 0,
          is_urgent: false,
        });
      }
    }

    // Aggregate analytics data
    const totalUsers = results.length;
    const notificationAllCount = results.filter((r) => r.notification_all).length;
    const notificationUrgentCount = results.filter((r) => r.notification_urgent).length;
    const noNotificationCount = results.filter((r) => r.no_notification).length;
    const noDeviceCount = results.filter((r) => r.no_device).length;

    // Create aggregate event
    const dailyNotifications: DailyNotificationsEventParams = {
      total_users_count: totalUsers,
      notification_all_count: notificationAllCount,
      notification_urgent_count: notificationUrgentCount,
      no_notification_count: noNotificationCount,
      no_device_count: noDeviceCount,
    };

    // Track analytics events
    const analyticsEvents = [
      {
        eventName: EventName.DAILY_NOTIFICATIONS_SENT,
        params: dailyNotifications,
      },
      ...results.map((result) => ({
        eventName: EventName.DAILY_NOTIFICATION_SENT,
        params: result,
      })),
    ];

    await trackApiEvents(analyticsEvents, SYSTEM_USER);
    logger.info(`Tracked ${analyticsEvents.length} analytics events`);

    logger.info(`Completed daily notification processing: ${totalUsers} users processed`);
  } catch (error) {
    logger.error('Error processing daily notifications:', error);
  }
};
