import { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { Change, FirestoreEvent } from 'firebase-functions/v2/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventName, NotificationEventParams } from '../models/analytics-events.js';
import { NotificationTypes } from '../models/constants.js';
import { JoinRequestDoc, JoinRequestStatus } from '../models/firestore/index.js';
import { NotificationService } from '../services/notification-service.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Firestore trigger function that runs when a join request is updated.
 * Sends rejection notifications to requesters when their requests are rejected.
 *
 * @param event - The Firestore event object containing the document data
 */
export const onJoinRequestUpdated = async (
  event: FirestoreEvent<
    Change<QueryDocumentSnapshot> | undefined,
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
    const requestData = requestSnapshot.after.data() as JoinRequestDoc;

    if (!requestData) {
      logger.error('Join request data is null');
      return;
    }

    // Extract IDs from parameters
    const requestId = event.params.joinRequestId;
    const requesterId = requestData.requester_id;

    if (!requestId) {
      logger.error(`No request ID found`);
      return;
    }

    if (!requesterId) {
      logger.error(`No requester ID found for request ${requestId}`);
      return;
    }

    logger.info(`Processing join request update: ${requestId}`);

    // Initialize NotificationService
    const notificationService = new NotificationService();

    let notificationResult: NotificationEventParams = {
      notification_all: false,
      notification_urgent: false,
      no_notification: true,
      no_device: false,
      notification_length: 0,
      is_urgent: false,
    };

    // Only send notification if the request was rejected
    if (requestData.status === JoinRequestStatus.REJECTED) {
      // Get receiver's profile info from denormalized data
      const receiverName = requestData.receiver_name || requestData.receiver_username || 'Friend';

      try {
        const rejectionResult = await notificationService.sendNotification(
          [requesterId],
          'Request Update',
          `${receiverName} rejected your request to join!`,
          {
            type: NotificationTypes.JOIN_REQUEST_REJECTED,
            request_id: requestId,
          },
        );

        // Also send background notification
        await notificationService.sendBackgroundNotification([requesterId], {
          type: NotificationTypes.JOIN_REQUEST_REJECTED_BACKGROUND,
          request_id: requestId,
        });

        notificationResult = rejectionResult;

        logger.info(`Sent rejection notification to requester ${requesterId}`);
      } catch (error) {
        logger.error(`Failed to send join request rejection notification to requester ${requesterId}`, error);
        notificationResult.no_device = true;
        notificationResult.no_notification = true;
      }
    } else {
      logger.info(`Request was not rejected for request ${requestId}, skipping notification`);
    }

    // Track analytics using the notification results
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
