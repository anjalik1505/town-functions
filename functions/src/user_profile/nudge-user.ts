import { Request } from 'express';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { ApiResponse, EventName, UserNudgeEventParams } from '../models/analytics-events.js';
import { Collections, NotificationTypes } from '../models/constants.js';
import { deviceConverter, nudgeConverter, NudgeDoc, profileConverter } from '../models/firestore/index.js';
import { BadRequestError, ConflictError, ForbiddenError } from '../utils/errors.js';
import { areFriends } from '../utils/friendship-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { sendNotification } from '../utils/notification-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));
const NUDGE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * Nudges a user to send an update.
 *
 * This function allows a user to nudge another user to send an update.
 * It enforces friendship checks to ensure only friends can nudge each other.
 * It also implements rate limiting to ensure a user can only nudge another user once per hour.
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Route parameters containing:
 *                - target_user_id: The ID of the user to nudge
 *
 * @returns An ApiResponse with a success message
 *
 * @throws 400: Target user ID is required
 * @throws 403: You must be friends with this user to nudge them
 * @throws 409: You can only nudge this user once per hour
 */
export const nudgeUser = async (req: Request): Promise<ApiResponse<{ message: string }>> => {
  const currentUserId = req.userId;
  const targetUserId = req.params.target_user_id;

  logger.info(`User ${currentUserId} is attempting to nudge user ${targetUserId}`);

  const db = getFirestore();

  if (!targetUserId) {
    throw new BadRequestError('Target user ID is required');
  }

  // Prevent users from nudging themselves
  if (currentUserId === targetUserId) {
    logger.warn(`User ${currentUserId} attempted to nudge themselves`);
    throw new BadRequestError('You cannot nudge yourself');
  }

  // Check if users are friends
  const areFriendsResult = await areFriends(currentUserId, targetUserId);

  // If they are not friends, return an error
  if (!areFriendsResult) {
    logger.warn(`User ${currentUserId} attempted to nudge non-friend ${targetUserId}`);
    throw new ForbiddenError('You must be friends with this user to nudge them');
  }

  logger.info(`Friendship verified between ${currentUserId} and ${targetUserId}`);

  // Check if the user has already nudged the target user within the cooldown period
  const nudgeId = `${currentUserId}_${targetUserId}`;
  const nudgeRef = db.collection(Collections.NUDGES).withConverter(nudgeConverter).doc(nudgeId);
  const nudgeDoc = await nudgeRef.get();

  if (nudgeDoc.exists) {
    const nudgeData = nudgeDoc.data();
    if (nudgeData) {
      const lastNudgeTime = nudgeData.timestamp.toDate().getTime();
      const currentTime = Date.now();

      if (currentTime - lastNudgeTime < NUDGE_COOLDOWN_MS) {
        logger.warn(`User ${currentUserId} attempted to nudge user ${targetUserId} too soon after previous nudge`);
        throw new ConflictError('You can only nudge this user once per hour');
      }
    }
  }

  // Get the target user's device
  const deviceDoc = await db.collection(Collections.DEVICES).withConverter(deviceConverter).doc(targetUserId).get();
  if (!deviceDoc.exists) {
    logger.info(`No device found for user ${targetUserId}`);
    // We'll still record the nudge but won't send a notification
  } else {
    const deviceData = deviceDoc.data();
    const deviceId = deviceData?.device_id;

    if (deviceId) {
      // Get the current user's name or username for the notification
      const currentUserProfileDoc = await db
        .collection(Collections.PROFILES)
        .withConverter(profileConverter)
        .doc(currentUserId)
        .get();
      const currentUserData = currentUserProfileDoc.data();
      const currentUserName = currentUserData?.name || currentUserData?.username || 'A friend';

      // Send the notification
      try {
        await sendNotification(
          deviceId,
          'You’ve been on someone’s mind',
          `${currentUserName} is checking in and curious about how you're doing!`,
          {
            type: NotificationTypes.NUDGE,
            sender_id: currentUserId,
          },
        );
        logger.info(`Successfully sent nudge notification to user ${targetUserId}`);
      } catch (error) {
        logger.error(`Error sending nudge notification to user ${targetUserId}: ${error}`);
        // Continue execution even if notification fails
      }
    }
  }

  // Record the nudge with the current timestamp
  const nudgeData: NudgeDoc = {
    sender_id: currentUserId,
    receiver_id: targetUserId,
    timestamp: Timestamp.now(),
  };
  await nudgeRef.set(nudgeData);

  const analyticsParams: UserNudgeEventParams = {
    target_user_id: targetUserId,
  };

  return {
    data: { message: 'Nudge sent successfully' },
    status: 200,
    analytics: {
      event: EventName.USER_NUDGED,
      userId: currentUserId,
      params: analyticsParams,
    },
  };
};
