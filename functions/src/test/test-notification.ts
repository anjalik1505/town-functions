import { Request, Response } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { Collections } from '../models/constants.js';
import { DeviceDoc } from '../models/firestore/device-doc.js';
import { NotificationResponse, TestNotificationPayload } from '../models/data-models.js';
import { NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Sends a test notification to the user's device.
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: The validated request parameters containing:
 *                - title: The notification title
 *                - body: The notification body text
 * @param res - The Express response object
 *
 * @returns A NotificationResponse if the notification was sent successfully
 *
 * @throws {404} Device not found
 */
export const testNotification = async (req: Request, res: Response): Promise<void> => {
  const currentUserId = req.userId;
  logger.info(`Sending test notification to user ${currentUserId}`);

  // Get validated data from request
  const { title, body } = req.validated_params as TestNotificationPayload;

  // Initialize Firestore client
  const db = getFirestore();

  // Get the user's device token
  const deviceRef = db.collection(Collections.DEVICES).doc(currentUserId);
  const deviceDoc = await deviceRef.get();

  if (!deviceDoc.exists) {
    logger.warn(`Device not found for user ${currentUserId}`);
    throw new NotFoundError('Device not found. Please register a device first.');
  }

  const deviceData = deviceDoc.data() as DeviceDoc | undefined;
  const deviceToken = deviceData?.device_id;

  if (!deviceToken) {
    logger.warn(`No device token found for user ${currentUserId}`);
    throw new NotFoundError('Device token not found. Please register a device first.');
  }

  // Initialize Firebase Messaging
  const messaging = getMessaging();

  // Send the notification
  const message = {
    notification: {
      title,
      body,
    },
    token: deviceToken,
  };

  const response = await messaging.send(message);
  logger.info(`Successfully sent notification to user ${currentUserId}: ${response}`);

  const notificationResponse: NotificationResponse = {
    success: true,
    message: 'Notification sent successfully',
    messageId: response,
  };

  res.json(notificationResponse);
};
