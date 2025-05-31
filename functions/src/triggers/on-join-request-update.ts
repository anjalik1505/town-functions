import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { Change, FirestoreEvent } from 'firebase-functions/v2/firestore';
import { EventName, NotificationEventParams } from '../models/analytics-events.js';
import { Collections, DeviceFields, JoinRequestFields, Status } from '../models/constants.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { sendNotification } from '../utils/notification-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';
import { ParamsOf } from 'firebase-functions';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Sends a notification to the request creator when the request was rejected
 *
 * @param db - Firestore client
 * @param requestData - The request document data
 * @param requestId - The ID of the request
 * @param requesterId - The ID of the user who owns the request
 * @returns Analytics data for this notification
 */
const sendJoinRequestUpdateNotification = async (
  db: FirebaseFirestore.Firestore,
  requestData: Record<string, unknown>,
  requestId: string,
  requesterId: string,
): Promise<NotificationEventParams> => {
  // Get the requester's device
  if (requestData[JoinRequestFields.STATUS] !== Status.REJECTED) {
    logger.info(`Request was not rejected for request ${requestId}, skipping notification`);
    return {
      notification_all: false,
      notification_urgent: false,
      no_notification: true,
      no_device: false,
      notification_length: 0,
      is_urgent: false,
    };
  }

  const deviceRef = db.collection(Collections.DEVICES).doc(requesterId);
  const deviceDoc = await deviceRef.get();

  if (!deviceDoc.exists) {
    logger.info(`No device found for requester ${requesterId}, skipping notification`);
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
    logger.info(`No device ID found for requester ${requesterId}, skipping notification`);
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
  const receiverName =
    requestData[JoinRequestFields.RECEIVER_NAME] || requestData[JoinRequestFields.RECEIVER_USERNAME] || 'Friend';

  // Send the notification
  try {
    const notificationMessage = `${receiverName} rejected your request to join!`;

    await sendNotification(deviceId, 'New Rejection', notificationMessage, {
      type: 'join_request_rejected',
      request_id: requestId,
    });

    logger.info(`Sent join request rejection notification to requester ${requesterId} for request ${requestId}`);

    return {
      notification_all: true,
      notification_urgent: false,
      no_notification: false,
      no_device: false,
      notification_length: notificationMessage.length,
      is_urgent: false,
    };
  } catch (error) {
    logger.error(`Failed to send join request rejection notification to requester ${requesterId}`, error);
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
export const onJoinRequestUpdated = async (
  event: FirestoreEvent<Change<QueryDocumentSnapshot> | undefined, ParamsOf<string>>,
): Promise<void> => {
  try {
    if (!event) {
      logger.error('Event is undefined');
      return;
    }

    const requestSnapshot = event.data;

    if (!requestSnapshot) {
      logger.error('No request data in event');
      return;
    }

    const requestData = requestSnapshot.after.data() || {};
    const requestId = event.params.id;
    if (!requestId) {
      logger.error(`No request ID found for request ${requestId}`);
      return;
    }

    const requesterId = requestData[JoinRequestFields.REQUESTER_ID] as string;
    if (!requesterId) {
      logger.error(`No requester ID found for request ${requestId}`);
      return;
    }

    const db = getFirestore();

    // Send notification to the requester
    const notificationResult = await sendJoinRequestUpdateNotification(db, requestData, requestId, requesterId);

    // Track analytics
    await trackApiEvents(
      [
        {
          eventName: EventName.JOIN_REQUEST_UPDATE_NOTIFICATION_SENT,
          params: notificationResult,
        },
      ],
      requesterId,
    );

    logger.info(`Successfully processed join request update notification for request ${requestId}`);
  } catch (error) {
    logger.error(`Error processing join request update notification:`, error);
  }
};
