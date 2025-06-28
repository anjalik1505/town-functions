import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FirestoreEvent } from 'firebase-functions/v2/firestore';
import { EventName, FriendshipAcceptanceEventParams } from '../models/analytics-events.js';
import { Collections } from '../models/constants.js';
import { FriendDocContext, FriendDoc } from '../models/firestore/friend-doc.js';
import { DeviceDoc } from '../models/firestore/device-doc.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { syncFriendshipDataForUser, upsertFriendDoc } from '../utils/friendship-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { sendNotification } from '../utils/notification-utils.js';
import { getProfileDoc } from '../utils/profile-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Creates a friendship acceptance event for analytics tracking
 */
const createFriendshipAcceptanceEvent = (hasDevice: boolean, senderId: string): void => {
  const friendshipEvent: FriendshipAcceptanceEventParams = {
    sender_has_name: true, // We'll assume profiles exist at this point
    sender_has_avatar: true,
    receiver_has_name: true,
    receiver_has_avatar: true,
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
 * Firestore trigger function that runs when a new friend document is created.
 * This function uses context detection to determine how to handle the friend document:
 *
 * - context: 'migration' -> Skip processing (migration from old system)
 * - context: 'join_request_accepted' -> Handle join request acceptance with notifications
 * - no context -> Handle as generic friendship creation
 *
 * @param event - The Firestore event object containing the document data
 */
export const onFriendshipCreated = async (
  event: FirestoreEvent<
    QueryDocumentSnapshot | undefined,
    {
      userId: string;
      friendId: string;
    }
  >,
): Promise<void> => {
  if (!event.data) {
    logger.error('No data in friend event');
    return;
  }

  const userId = event.params.userId; // Owner of the subcollection
  const friendId = event.params.friendId; // Document ID in subcollection
  const friendDocData = event.data.data() as FriendDoc;
  const context = friendDocData.context;
  const accepterId = friendDocData.accepter_id;
  const db = getFirestore();

  logger.info(`Processing friend document creation: ${userId}/${friendId} with context: ${context || 'none'}`);

  // Only process from the "primary" user (lexicographically smaller ID) to avoid duplicate work
  const primaryUserId = [userId, friendId].sort()[0];
  if (userId !== primaryUserId) {
    logger.info(`Skipping friendship processing - not primary user (${userId} vs ${primaryUserId})`);
    return;
  }

  logger.info(`Processing friendship creation from primary user ${userId} with friend ${friendId}`);

  try {
    // Run sync for both directions to update friend docs with latest update info
    // Get User 2's updates to update User 1's friend document about User 2
    // Get User 1's updates to update User 2's friend document about User 1
    const [user2UpdatesForUser1, user1UpdatesForUser2] = await Promise.all([
      syncFriendshipDataForUser(friendId, userId), // User 2's updates
      syncFriendshipDataForUser(userId, friendId), // User 1's updates
    ]);

    logger.info(`Successfully synced friendship data for ${userId} <-> ${friendId}`);

    // Update friend documents with latest update info from sync results
    const updatePromises: Promise<void>[] = [];

    // Update User 1's friend document about User 2 with User 2's latest update info
    if (user2UpdatesForUser1?.emoji || user2UpdatesForUser1?.updatedAt) {
      updatePromises.push(
        upsertFriendDoc(db, userId, friendId, {
          last_update_emoji: user2UpdatesForUser1.emoji,
          last_update_at: user2UpdatesForUser1.updatedAt,
        }),
      );
    }

    // Update User 2's friend document about User 1 with User 1's latest update info
    if (user1UpdatesForUser2?.emoji || user1UpdatesForUser2?.updatedAt) {
      updatePromises.push(
        upsertFriendDoc(db, friendId, userId, {
          last_update_emoji: user1UpdatesForUser2.emoji,
          last_update_at: user1UpdatesForUser2.updatedAt,
        }),
      );
    }

    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
      logger.info(`Updated friend documents with latest update info`);
    }

    // Handle join request acceptance context - send notifications
    if (context === FriendDocContext.JOIN_REQUEST_ACCEPTED && accepterId) {
      const requesterId = accepterId === userId ? friendId : userId;

      logger.info(`Handling join request acceptance: requester=${requesterId}, accepter=${accepterId}`);

      // Send notification to the requester that their request was accepted
      try {
        const deviceRef = db.collection(Collections.DEVICES).doc(requesterId);
        const deviceDoc = await deviceRef.get();

        if (deviceDoc.exists) {
          const deviceData = deviceDoc.data() as DeviceDoc | undefined;
          const deviceId = deviceData?.device_id;

          if (deviceId) {
            // Get accepter's name for notification
            const { data: accepterProfile } = await getProfileDoc(accepterId);
            const accepterName = accepterProfile.name || accepterProfile.username || 'Friend';
            const message = `${accepterName} accepted your request!`;

            await sendNotification(deviceId, 'New Friend!', message, {
              type: 'friendship',
            });

            logger.info(`Sent friendship acceptance notification to requester ${requesterId}`);
            createFriendshipAcceptanceEvent(true, requesterId);
          } else {
            logger.info(`No device ID found for requester ${requesterId}, skipping notification`);
            createFriendshipAcceptanceEvent(false, requesterId);
          }
        } else {
          logger.info(`No device found for requester ${requesterId}, skipping notification`);
          createFriendshipAcceptanceEvent(false, requesterId);
        }
      } catch (error) {
        logger.error(`Error sending friendship acceptance notification to requester ${requesterId}: ${error}`);
        // Continue execution even if notification fails
      }
    } else {
      logger.info(`No notification handling needed for context: ${context || 'none'}`);
    }
  } catch (error) {
    logger.error(`Failed to process friendship creation ${userId}/${friendId}`, error);
  }
};
