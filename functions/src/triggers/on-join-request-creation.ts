import { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FirestoreEvent } from 'firebase-functions/v2/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventName, NotificationEventParams } from '../models/analytics-events.js';
import { NotificationTypes } from '../models/constants.js';
import { JoinRequestDoc } from '../models/firestore/join-request-doc.js';
import { NotificationService } from '../services/notification-service.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Firestore trigger function that runs when a new join request is created.
 * Prepares and sends notifications directly using NotificationService.
 *
 * @param event - The Firestore event object containing the document data
 */
export const onJoinRequestCreated = async (
  event: FirestoreEvent<
    QueryDocumentSnapshot | undefined,
    {
      invitationId: string;
      joinRequestId: string;
    }
  >,
): Promise<void> => {
  try {
    const requestSnapshot = event.data;

    if (!requestSnapshot) {
      logger.error('No request data in event');
      return;
    }

    // Convert to typed document
    const requestData = requestSnapshot.data() as JoinRequestDoc;

    if (!requestData) {
      logger.error('Request data is null');
      return;
    }

    // Extract IDs from event parameters
    const requestId = event.params.joinRequestId;

    logger.info(`Processing join request creation: ${requestId}`);

    const receiverId = requestData.receiver_id;
    if (!receiverId) {
      logger.error(`No receiver ID found for request ${requestId}`);
      return;
    }

    // Initialize NotificationService
    const notificationService = new NotificationService();

    let totalNotificationResult: NotificationEventParams = {
      notification_all: false,
      notification_urgent: false,
      no_notification: true,
      no_device: false,
      notification_length: 0,
      is_urgent: false,
    };

    // Prepare notification data directly from the join request data
    const requesterName = requestData.requester_name || requestData.requester_username || 'Friend';
    const notificationTitle = 'New Request';
    const notificationMessage = `${requesterName} wants to join your village!`;

    try {
      const notificationResult = await notificationService.sendNotification(
        [receiverId],
        notificationTitle,
        notificationMessage,
        {
          type: NotificationTypes.JOIN_REQUEST,
          request_id: requestId,
        },
      );

      // Also send background notification
      await notificationService.sendBackgroundNotification([receiverId], {
        type: NotificationTypes.JOIN_REQUEST_BACKGROUND,
        request_id: requestId,
      });

      // Set analytics results
      totalNotificationResult = notificationResult;

      logger.info(`Sent join request notification to invitation owner ${receiverId}`);
    } catch (error) {
      logger.error(`Failed to send join request notification to invitation owner ${receiverId}`, error);
      totalNotificationResult.no_device = true;
    }

    // Track analytics using the notification results
    await trackApiEvents(
      [
        {
          eventName: EventName.JOIN_REQUEST_NOTIFICATION_SENT,
          params: totalNotificationResult,
        },
      ],
      receiverId,
    );

    logger.info(`Successfully processed join request notification for request ${requestId}`);
  } catch (error) {
    logger.error(`Error processing join request notification:`, error);
  }
};
