import { getMessaging } from 'firebase-admin/messaging';
import { NotificationTypes } from '../models/constants.js';
import { getLogger } from './logging-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Send a notification to a device
 * @param deviceId - The device token to send the notification to
 * @param title - The notification title
 * @param message - The notification message
 * @param data - Optional data to include with the notification
 */
export const sendNotification = async (
  deviceId: string,
  title: string,
  message: string,
  data?: Record<string, string>,
): Promise<void> => {
  try {
    const messaging = getMessaging();

    await messaging.send({
      token: deviceId,
      notification: {
        title,
        body: message,
      },
      data: {
        ...data,
        type: data?.type || NotificationTypes.DEFAULT,
      },
    });

    logger.info(`Successfully sent notification to device ${deviceId}`);
  } catch (error) {
    logger.error(`Error sending notification to device ${deviceId}: ${error}`);
    throw error;
  }
};

/**
 * Send a background/silent notification to a device
 * @param deviceId - The device token to send the notification to
 * @param data - Data to include with the background notification
 */
export const sendBackgroundNotification = async (deviceId: string, data: Record<string, string>): Promise<void> => {
  try {
    const messaging = getMessaging();

    await messaging.send({
      token: deviceId,
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

    logger.info(`Successfully sent background notification to device ${deviceId}`);
  } catch (error) {
    logger.error(`Error sending background notification to device ${deviceId}: ${error}`);
    throw error;
  }
};
