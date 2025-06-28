import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FirestoreEvent } from 'firebase-functions/v2/firestore';
import { EventName, NotificationEventParams } from '../models/analytics-events.js';
import { Collections, NotificationTypes } from '../models/constants.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { sendBackgroundNotification, sendNotification } from '../utils/notification-utils.js';

// Import typed converters and field selectors
import { CommentDoc, commentConverter, cf } from '../models/firestore/comment-doc.js';
import { updateConverter, uf } from '../models/firestore/update-doc.js';
import { deviceConverter, df } from '../models/firestore/device-doc.js';

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
  commentData: CommentDoc,
  updateId: string,
  commenterId: string,
): Promise<NotificationEventParams> => {
  // Fetch the update creator with typed converter
  const updateRef = db.collection(Collections.UPDATES).doc(updateId).withConverter(updateConverter);
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

  const updateData = updateDoc.data();
  if (!updateData) {
    logger.error('Update data is null');
    return {
      notification_all: false,
      notification_urgent: false,
      no_notification: true,
      no_device: false,
      notification_length: 0,
      is_urgent: false,
    };
  }

  const updateCreatorId = updateData[uf('created_by')];

  // Build a set of all participants: update creator + every previous commenter
  const participantIds = new Set<string>();
  if (updateCreatorId) {
    participantIds.add(updateCreatorId);
  }

  try {
    const commentsQuery = updateRef.collection(Collections.COMMENTS).withConverter(commentConverter);
    const commentsStream = commentsQuery.stream() as AsyncIterable<QueryDocumentSnapshot<CommentDoc>>;

    for await (const doc of commentsStream) {
      const commentDoc = doc.data();
      const createdBy = commentDoc[cf('created_by')];
      if (createdBy) {
        participantIds.add(createdBy);
      }
    }
  } catch (error) {
    logger.error(`Failed to stream existing comments for update ${updateId}`, error);
  }

  // Exclude the author of the new comment
  participantIds.delete(commenterId);

  // Get commenter profile from denormalized data
  const commenterProfile = commentData[cf('commenter_profile')];
  const commenterName = commenterProfile.name || commenterProfile.username || 'Friend';

  // Prepare comment snippet
  const commentContent = commentData[cf('content')] || '';
  const truncatedComment = commentContent.length > 50 ? `${commentContent.substring(0, 47)}...` : commentContent;

  let noDeviceCount = 0;
  let notificationsSent = 0;

  for (const targetUserId of participantIds) {
    try {
      const deviceRef = db.collection(Collections.DEVICES).doc(targetUserId).withConverter(deviceConverter);
      const deviceDoc = await deviceRef.get();

      if (!deviceDoc.exists) {
        noDeviceCount++;
        continue;
      }

      const deviceData = deviceDoc.data();
      if (!deviceData) {
        noDeviceCount++;
        continue;
      }

      const deviceId = deviceData[df('device_id')];
      if (!deviceId) {
        noDeviceCount++;
        continue;
      }

      const message =
        targetUserId === updateCreatorId
          ? `${commenterName} commented on your post: "${truncatedComment}"`
          : `${commenterName} also commented on a post you're following: "${truncatedComment}"`;

      await sendNotification(deviceId, 'New Comment', message, {
        type: NotificationTypes.COMMENT,
        update_id: updateId,
      });

      // Send background notification
      await sendBackgroundNotification(deviceId, {
        type: NotificationTypes.COMMENT_BACKGROUND,
        update_id: updateId,
      });

      notificationsSent++;
      logger.info(`Sent comment notification to user ${targetUserId} for update ${updateId}`);
    } catch (error) {
      logger.error(`Failed to send comment notification to user ${targetUserId}`, error);
    }
  }

  return {
    notification_all: notificationsSent > 0,
    notification_urgent: false,
    no_notification: notificationsSent === 0,
    no_device: noDeviceCount > 0,
    notification_length: truncatedComment.length,
    is_urgent: false,
  };
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

    // Convert to typed document
    const commentData = commentSnapshot.data() as CommentDoc;

    if (!commentData) {
      logger.error('Comment data is null');
      return;
    }

    const commentId = event.params.id;
    const updateId = commentSnapshot.ref.parent.parent?.id;

    if (!updateId) {
      logger.error(`Could not determine parent update ID for comment ${commentId}`);
      return;
    }

    logger.info(`Processing comment creation: ${commentId} on update ${updateId}`);

    const commenterId = commentData[cf('created_by')];
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
