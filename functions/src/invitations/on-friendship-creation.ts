import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FirestoreEvent } from 'firebase-functions/v2/firestore';
import {
  EventName,
  FriendshipAcceptanceEventParams,
} from '../models/analytics-events';
import {
  Collections,
  DeviceFields,
  FriendshipFields,
  Status,
} from '../models/constants';
import { getLogger } from '../utils/logging-utils';
import { syncFriendshipDataForUser } from '../utils/friendship-utils';
import { sendNotification } from '../utils/notification-utils';
import { trackApiEvents } from '../utils/analytics-utils';

const logger = getLogger(__filename);

/**
 * Creates a friendship acceptance event for analytics tracking
 *
 * @param friendshipData - The friendship document data
 * @param hasDevice - Whether the user has a device for notifications
 * @param senderId - The ID of the sender
 * @returns FriendshipAcceptanceEventParams object for analytics
 */
const createFriendshipAcceptanceEvent = (
  friendshipData: Record<string, any>,
  hasDevice: boolean,
  senderId: string,
): void => {
  const friendshipEvent: FriendshipAcceptanceEventParams = {
    sender_has_name: !!friendshipData[FriendshipFields.SENDER_NAME],
    sender_has_avatar: !!friendshipData[FriendshipFields.SENDER_AVATAR],
    receiver_has_name: !!friendshipData[FriendshipFields.RECEIVER_NAME],
    receiver_has_avatar: !!friendshipData[FriendshipFields.RECEIVER_AVATAR],
    has_device: hasDevice,
  };

  trackApiEvents(
    [
      {
        eventName: EventName.FRIENDSHIP_ACCEPTED,
        params: friendshipEvent,
      },
    ],
    senderId,
  );
};

/**
 * Firestore trigger function that runs when a new friendship is created.
 * This function:
 * 1. Queries all updates of the friendship sender that have all_village=true
 * 2. Creates feed items for the receiver for each of these updates
 * 3. Gets the last 10 shared items and triggers the friend summary AI flow
 *
 * @param event - The Firestore event object containing the document data
 */
export const onFriendshipCreated = async (
  event: FirestoreEvent<
    QueryDocumentSnapshot | undefined,
    {
      id: string;
    }
  >,
): Promise<void> => {
  if (!event.data) {
    logger.error('No data in friendship event');
    return;
  }

  logger.info(`Processing new friendship: ${event.data.id}`);

  // Get the friendship data directly from the event
  const friendshipData = event.data.data() || {};

  // Check if the friendship has the required fields and is in ACCEPTED status
  if (
    !friendshipData ||
    !friendshipData[FriendshipFields.SENDER_ID] ||
    !friendshipData[FriendshipFields.RECEIVER_ID] ||
    friendshipData[FriendshipFields.STATUS] !== Status.ACCEPTED
  ) {
    logger.error(
      `Friendship ${event.data.id} has invalid data or is not in ACCEPTED status`,
    );
    return;
  }

  // Get the sender and receiver IDs
  const senderId = friendshipData[FriendshipFields.SENDER_ID];
  const receiverId = friendshipData[FriendshipFields.RECEIVER_ID];

  // Run both sync directions in parallel
  await Promise.all([
    syncFriendshipDataForUser(senderId, receiverId, {
      ...friendshipData,
      id: event.data.id,
    }),
    syncFriendshipDataForUser(receiverId, senderId, {
      ...friendshipData,
      id: event.data.id,
    }),
  ]);

  // Send notification to the sender that their invitation was accepted
  try {
    // Get the sender's device ID
    const db = getFirestore();
    const deviceRef = db.collection(Collections.DEVICES).doc(senderId);
    const deviceDoc = await deviceRef.get();

    if (deviceDoc.exists) {
      const deviceData = deviceDoc.data() || {};
      const deviceId = deviceData[DeviceFields.DEVICE_ID];

      if (deviceId) {
        // Get the receiver's name from the friendship data
        const receiverName =
          friendshipData[FriendshipFields.RECEIVER_NAME] ||
          friendshipData[FriendshipFields.RECEIVER_USERNAME] ||
          'Friend';

        // Create the notification message
        const message = `${receiverName} accepted your invitation!`;

        // Send the notification
        await sendNotification(deviceId, 'New Friend!', message, {
          type: 'friendship',
          friendship_id: event.data.id,
        });

        logger.info(
          `Sent friendship acceptance notification to user ${senderId}`,
        );

        // Track friendship acceptance event for analytics
        createFriendshipAcceptanceEvent(friendshipData, true, senderId);

        logger.info(`Tracked friendship acceptance event`);
      } else {
        logger.info(
          `No device ID found for user ${senderId}, skipping notification`,
        );

        // Track event for skipped notification due to missing device ID
        createFriendshipAcceptanceEvent(friendshipData, false, senderId);

        logger.info(`Tracked no-device event for friendship acceptance`);
      }
    } else {
      logger.info(
        `No device found for user ${senderId}, skipping notification`,
      );

      // Track event for skipped notification due to missing device
      createFriendshipAcceptanceEvent(friendshipData, false, senderId);

      logger.info(`Tracked no-device event for friendship acceptance`);
    }
  } catch (error) {
    logger.error(
      `Error sending friendship acceptance notification to user ${senderId}: ${error}`,
    );
    // Continue execution even if notification fails
  }
};
