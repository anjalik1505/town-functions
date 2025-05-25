import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FirestoreEvent } from 'firebase-functions/v2/firestore';
import { EventName, NotificationEventParams } from '../models/analytics-events.js';
import { Collections, CommentFields, DeviceFields, UpdateFields } from '../models/constants.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { sendNotification } from '../utils/notification-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Sends a notification to the update creator when a new comment is added.
 *
 * @param db - Firestore client
 * @param commentData - The comment document data
 * @param updateId - The ID of the update that was commented on
 * @param commenterId - The ID of the user who created the comment
 * @returns Analytics data for this notification
 */
const sendCommentNotification = async (
  db: FirebaseFirestore.Firestore,
  commentData: Record<string, unknown>,
  updateId: string,
  commenterId: string,
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

  // Skip if the commenter is the update creator (commenting on their own update)
  if (commenterId === updateCreatorId) {
    logger.info(`Skipping notification for update creator: ${updateCreatorId} (self-comment)`);
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

  // Get commenter's profile to include their name in the notification
  const commenterProfileRef = db.collection(Collections.PROFILES).doc(commenterId);
  const commenterProfileDoc = await commenterProfileRef.get();
  const commenterProfileData = commenterProfileDoc.exists ? commenterProfileDoc.data() || {} : {};
  const commenterName = commenterProfileData.name || commenterProfileData.username || 'Friend';

  // Get comment content
  const commentContent = (commentData[CommentFields.CONTENT] as string) || '';
  const truncatedComment = commentContent.length > 50 ? `${commentContent.substring(0, 47)}...` : commentContent;

  // Send the notification
  try {
    const notificationMessage = `${commenterName} commented on your post: "${truncatedComment}"`;

    await sendNotification(deviceId, 'New Comment', notificationMessage, {
      type: 'comment',
      update_id: updateId,
    });

    logger.info(`Sent comment notification to update creator ${updateCreatorId} for update ${updateId}`);

    return {
      notification_all: true,
      notification_urgent: false,
      no_notification: false,
      no_device: false,
      notification_length: notificationMessage.length,
      is_urgent: false,
    };
  } catch (error) {
    logger.error(`Failed to send comment notification to update creator ${updateCreatorId}`, error);
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
 * Firestore trigger function that runs when a new comment is created.
 *
 * @param event - The Firestore event object containing the document data
 */
export const onCommentCreated = async (
  event: FirestoreEvent<
    QueryDocumentSnapshot | undefined,
    {
      id: string;
    }
  >,
): Promise<void> => {
  try {
    const commentSnapshot = event.data;

    if (!commentSnapshot) {
      logger.error('No comment data in event');
      return;
    }

    const commentData = commentSnapshot.data() || {};
    const commentId = event.params.id;
    const updateId = commentSnapshot.ref.parent.parent?.id;

    if (!updateId) {
      logger.error(`Could not determine parent update ID for comment ${commentId}`);
      return;
    }

    logger.info(`Processing comment creation: ${commentId} on update ${updateId}`);

    const commenterId = commentData[CommentFields.CREATED_BY] as string;
    if (!commenterId) {
      logger.error(`No creator ID found for comment ${commentId}`);
      return;
    }

    const db = getFirestore();

    // Send notification to the update creator
    const notificationResult = await sendCommentNotification(db, commentData, updateId, commenterId);

    // Track analytics
    await trackApiEvents(
      [
        {
          eventName: EventName.COMMENT_NOTIFICATION_SENT,
          params: notificationResult,
        },
      ],
      commenterId,
    );

    logger.info(`Successfully processed comment notification for comment ${commentId}`);
  } catch (error) {
    logger.error(`Error processing comment notification:`, error);
  }
};
