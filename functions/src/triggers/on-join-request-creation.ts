import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FirestoreEvent } from 'firebase-functions/v2/firestore';
import { EventName, NotificationEventParams } from '../models/analytics-events.js';
import { Collections, DeviceFields, JoinRequestFields, NotificationTypes } from '../models/constants.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { sendBackgroundNotification, sendNotification } from '../utils/notification-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Sends a notification to the invitation owner when a new request is created.
 *
 * @param db - Firestore client
 * @param requestData - The request document data
 * @param requestId - The ID of the request
 * @param receiverId - The ID of the user who owns the invitation
 * @returns Analytics data for this notification
 */
const sendJoinRequestNotification = async (
  db: FirebaseFirestore.Firestore,
  requestData: Record<string, unknown>,
  requestId: string,
  receiverId: string,
): Promise<NotificationEventParams> => {
  // Get the invitation owner's device
  const deviceRef = db.collection(Collections.DEVICES).doc(receiverId);
  const deviceDoc = await deviceRef.get();

  if (!deviceDoc.exists) {
    logger.info(`No device found for invitation owner ${receiverId}, skipping notification`);
    return {
      notification_all: false,
      notification_urgent: false,
      no_notification: false,
      no_device: true,
      notification_length: 0,
      is_urgent: false,
    };
  }

  const deviceData = deviceDoc.data() || {};
  const deviceId = deviceData[DeviceFields.DEVICE_ID];

  if (!deviceId) {
    logger.info(`No device ID found for invitation owner ${receiverId}, skipping notification`);
    return {
      notification_all: false,
      notification_urgent: false,
      no_notification: false,
      no_device: true,
      notification_length: 0,
      is_urgent: false,
    };
  }

  // Get requester's profile to include their name in the notification
  const requesterName =
    requestData[JoinRequestFields.REQUESTER_NAME] || requestData[JoinRequestFields.REQUESTER_USERNAME] || 'Friend';

  // Send the notification
  try {
    const notificationMessage = `${requesterName} wants to join your village!`;

    await sendNotification(deviceId, 'New Request', notificationMessage, {
      type: NotificationTypes.JOIN_REQUEST,
      request_id: requestId,
    });

    // Send background notification
    await sendBackgroundNotification(deviceId, {
      type: NotificationTypes.JOIN_REQUEST_BACKGROUND,
      request_id: requestId,
    });

    logger.info(`Sent join request notification to invitation owner ${receiverId} for request ${requestId}`);

    return {
      notification_all: true,
      notification_urgent: false,
      no_notification: false,
      no_device: false,
      notification_length: notificationMessage.length,
      is_urgent: false,
    };
  } catch (error) {
    logger.error(`Failed to send join request notification to invitation owner ${receiverId}`, error);
    return {
      notification_all: false,
      notification_urgent: false,
      no_notification: true,
      no_device: false,
      notification_length: 0,
      is_urgent: false,
    };
  }
};

/**
 * Firestore trigger function that runs when a new join request is created.
 *
 * @param event - The Firestore event object containing the document data
 */
export const onJoinRequestCreated = async (
  event: FirestoreEvent<
    QueryDocumentSnapshot | undefined,
    {
      id: string;
    }
  >,
): Promise<void> => {
  try {
    const requestSnapshot = event.data;

    if (!requestSnapshot) {
      logger.error('No request data in event');
      return;
    }

    const requestData = requestSnapshot.data() || {};
    const requestId = event.params.id;

    const receiverId = requestData[JoinRequestFields.RECEIVER_ID] as string;
    if (!receiverId) {
      logger.error(`No requester ID found for request ${requestId}`);
      return;
    }

    const db = getFirestore();

    // Send notification to the invitation owner
    const notificationResult = await sendJoinRequestNotification(db, requestData, requestId, receiverId);

    // Track analytics
    await trackApiEvents(
      [
        {
          eventName: EventName.JOIN_REQUEST_NOTIFICATION_SENT,
          params: notificationResult,
        },
      ],
      receiverId,
    );

    logger.info(`Successfully processed join request notification for request ${requestId}`);
  } catch (error) {
    logger.error(`Error processing join request notification:`, error);
  }
};
