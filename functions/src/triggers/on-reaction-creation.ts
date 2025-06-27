import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FirestoreEvent } from 'firebase-functions/v2/firestore';
import { EventName, NotificationEventParams } from '../models/analytics-events.js';
import { Collections, DeviceFields, NotificationTypes, ReactionFields, UpdateFields } from '../models/constants.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { sendBackgroundNotification, sendNotification } from '../utils/notification-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Sends a notification to the update creator when a new reaction is added.
 *
 * @param db - Firestore client
 * @param reactionTypes - The array of reaction types from the reaction document
 * @param updateId - The ID of the update that received the reaction
 * @param reactorId - The ID of the user who created the reaction
 * @returns Analytics data for this notification
 */
const sendReactionNotification = async (
  db: FirebaseFirestore.Firestore,
  reactionTypes: string[],
  updateId: string,
  reactorId: string,
): Promise<NotificationEventParams> => {
  // Get the update document to find the creator
  const updateRef = db.collection(Collections.UPDATES).doc(updateId);
  const updateDoc = await updateRef.get();

  if (!updateDoc.exists) {
    logger.warn(`Update not found for ID ${updateId}`);
    return {
      notification_all: false,
      notification_urgent: false,
      no_notification: true,
      no_device: false,
      notification_length: 0,
      is_urgent: false,
    };
  }

  const updateData = updateDoc.data() || {};
  const updateCreatorId = updateData[UpdateFields.CREATED_BY] as string;

  // Skip if the reactor is the update creator (reacting to their own update)
  if (reactorId === updateCreatorId) {
    logger.info(`Skipping notification for update creator: ${updateCreatorId} (self-reaction)`);
    return {
      notification_all: false,
      notification_urgent: false,
      no_notification: true,
      no_device: false,
      notification_length: 0,
      is_urgent: false,
    };
  }

  // Get the update creator's device
  const deviceRef = db.collection(Collections.DEVICES).doc(updateCreatorId);
  const deviceDoc = await deviceRef.get();

  if (!deviceDoc.exists) {
    logger.info(`No device found for update creator ${updateCreatorId}, skipping notification`);
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
    logger.info(`No device ID found for update creator ${updateCreatorId}, skipping notification`);
    return {
      notification_all: false,
      notification_urgent: false,
      no_notification: false,
      no_device: true,
      notification_length: 0,
      is_urgent: false,
    };
  }

  // Get reactor's profile to include their name in the notification
  const reactorProfileRef = db.collection(Collections.PROFILES).doc(reactorId);
  const reactorProfileDoc = await reactorProfileRef.get();
  const reactorProfileData = reactorProfileDoc.exists ? reactorProfileDoc.data() || {} : {};
  const reactorName = reactorProfileData.name || reactorProfileData.username || 'Friend';

  // Get the most recent reaction type (last in the array)
  const reactionType = reactionTypes.length > 0 ? reactionTypes[reactionTypes.length - 1] : 'like';

  // Send the notification
  try {
    const notificationMessage = `${reactorName} reacted to your update with ${reactionType}`;

    await sendNotification(deviceId, 'New Reaction', notificationMessage, {
      type: NotificationTypes.REACTION,
      update_id: updateId,
    });

    // Send background notification
    await sendBackgroundNotification(deviceId, {
      type: NotificationTypes.REACTION_BACKGROUND,
      update_id: updateId,
    });

    logger.info(`Sent reaction notification to update creator ${updateCreatorId} for update ${updateId}`);

    return {
      notification_all: true,
      notification_urgent: false,
      no_notification: false,
      no_device: false,
      notification_length: notificationMessage.length,
      is_urgent: false,
    };
  } catch (error) {
    logger.error(`Failed to send reaction notification to update creator ${updateCreatorId}`, error);
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
 * Firestore trigger function that runs when a new reaction is created.
 *
 * @param event - The Firestore event object containing the document data
 */
export const onReactionCreated = async (
  event: FirestoreEvent<
    QueryDocumentSnapshot | undefined,
    {
      id: string;
    }
  >,
): Promise<void> => {
  try {
    const reactionSnapshot = event.data;

    if (!reactionSnapshot) {
      logger.error('No reaction data in event');
      return;
    }

    const reactionData = reactionSnapshot.data() || {};
    const reactorId = event.params.id; // Document ID is now the userId
    const updateId = reactionSnapshot.ref.parent.parent?.id;

    if (!updateId) {
      logger.error(`Could not determine parent update ID for reaction by user ${reactorId}`);
      return;
    }

    // Get the reaction types array from the document
    const reactionTypes = (reactionData[ReactionFields.TYPES] as string[]) || [];
    if (reactionTypes.length === 0) {
      logger.warn(`No reaction types found in reaction document for user ${reactorId}`);
      return;
    }

    logger.info(
      `Processing reaction creation: user ${reactorId} on update ${updateId} with types ${reactionTypes.join(', ')}`,
    );

    const db = getFirestore();

    // Send notification to the update creator
    const notificationResult = await sendReactionNotification(db, reactionTypes, updateId, reactorId);

    // Track analytics
    await trackApiEvents(
      [
        {
          eventName: EventName.REACTION_NOTIFICATION_SENT,
          params: notificationResult,
        },
      ],
      reactorId,
    );

    logger.info(`Successfully processed reaction notification for user ${reactorId} on update ${updateId}`);
  } catch (error) {
    logger.error(`Error processing reaction notification:`, error);
  }
};
