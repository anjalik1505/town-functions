import { getMessaging } from 'firebase-admin/messaging';
import path from 'path';
import { fileURLToPath } from 'url';
import { DeviceDAO } from '../dao/device-dao.js';
import { NotificationEventParams } from '../models/analytics-events.js';
import { NotificationTypes } from '../models/constants.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Service layer for notification operations
 * Handles device token retrieval and notification sending
 */
export class NotificationService {
  private deviceDAO: DeviceDAO;

  constructor() {
    this.deviceDAO = new DeviceDAO();
  }

  /**
   * Send visible notifications to users
   * @param userIds - Array of user IDs (even single user: [userId])
   * @param title - Notification title
   * @param message - Notification message
   * @param data - Optional data payload
   */
  async sendNotification(
    userIds: string[],
    title: string,
    message: string,
    data?: Record<string, string>,
  ): Promise<NotificationEventParams> {
    if (!userIds || !userIds.length || !title || !message) {
      logger.warn('Invalid parameters for sendNotification');
      return {
        notification_all: false,
        notification_urgent: false,
        no_notification: true,
        no_device: false,
        notification_length: 0,
        is_urgent: false,
      } as NotificationEventParams;
    }

    let notificationsSent = 0;
    let noDeviceCount = 0;

    for (const userId of userIds) {
      const deviceToken = await this.getDeviceToken(userId);

      if (!deviceToken) {
        logger.warn(`No device token found for user ${userId}`);
        noDeviceCount++;
      } else {
        try {
          const messaging = getMessaging();

          await messaging.send({
            token: deviceToken,
            notification: {
              title,
              body: message,
            },
            data: {
              ...data,
              type: data?.type || NotificationTypes.DEFAULT,
            },
          });

          logger.info(`Successfully sent notification to user ${userId} (device: ${deviceToken})`);
          notificationsSent++;
        } catch (error) {
          logger.error(`Error sending notification to user ${userId}: ${error}`);
        }
      }
    }

    return {
      notification_all: notificationsSent > 0,
      notification_urgent: false,
      no_notification: notificationsSent === 0,
      no_device: noDeviceCount > 0,
      notification_length: message.length,
      is_urgent: false,
    } as NotificationEventParams;
  }

  /**
   * Send background/silent notifications to users
   * @param userIds - Array of user IDs (even single user: [userId])
   * @param data - Data payload for background notification
   */
  async sendBackgroundNotification(userIds: string[], data: Record<string, string>): Promise<NotificationEventParams> {
    if (!userIds || !userIds.length || !data) {
      logger.warn('Invalid parameters for sendBackgroundNotification');
      return {
        notification_all: false,
        notification_urgent: false,
        no_notification: true,
        no_device: false,
        notification_length: 0,
        is_urgent: false,
      } as NotificationEventParams;
    }

    let notificationsSent = 0;
    let noDeviceCount = 0;

    for (const userId of userIds) {
      const deviceToken = await this.getDeviceToken(userId);

      if (!deviceToken) {
        logger.warn(`No device token found for user ${userId}`);
        noDeviceCount++;
      } else {
        try {
          const messaging = getMessaging();

          await messaging.send({
            token: deviceToken,
            data: {
              ...data,
              type: data?.type || NotificationTypes.BACKGROUND,
            },
            android: {
              priority: 'high',
            },
            apns: {
              headers: {
                'apns-priority': '5',
              },
              payload: {
                aps: {
                  'content-available': 1,
                  alert: '',
                },
              },
            },
          });

          logger.info(`Successfully sent background notification to user ${userId} (device: ${deviceToken})`);
          notificationsSent++;
        } catch (error) {
          logger.error(`Error sending background notification to user ${userId}: ${error}`);
        }
      }
    }

    return {
      notification_all: notificationsSent > 0,
      notification_urgent: false,
      no_notification: notificationsSent === 0,
      no_device: noDeviceCount > 0,
      notification_length: 0,
      is_urgent: false,
    } as NotificationEventParams;
  }

  /**
   * Get the device token for a user
   * @param userId - The user ID to get the device token for
   * @returns The device token or null if no device exists
   */
  private async getDeviceToken(userId: string): Promise<string | null> {
    try {
      const deviceData = await this.deviceDAO.get(userId);
      return deviceData?.device_id || null;
    } catch (error) {
      logger.error(`Error retrieving device token for user ${userId}: ${error}`);
      return null;
    }
  }
}
