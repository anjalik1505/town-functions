import { getMessaging } from 'firebase-admin/messaging';
import { getLogger } from './logging-utils';

const logger = getLogger(__filename);

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
        type: data?.type || 'default',
      },
    });

    logger.info(`Successfully sent notification to device ${deviceId}`);
  } catch (error) {
    logger.error(`Error sending notification to device ${deviceId}: ${error}`);
    throw error;
  }
};
