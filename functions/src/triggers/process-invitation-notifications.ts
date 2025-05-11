import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import {
  EventName,
  InvitationNotificationEventParams,
  InvitationNotificationsEventParams,
} from '../models/analytics-events.js';
import {
  Collections,
  DeviceFields,
  FriendshipFields,
  ProfileFields,
  QueryOperators,
  SYSTEM_USER,
} from '../models/constants.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { sendNotification } from '../utils/notification-utils.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

// Configuration constants
const MIN_PROFILE_AGE_DAYS = 1;
const NOTIFICATION_TITLE = 'Your Village wants to hear from you!';
const NOTIFICATION_BODY =
  'Invite your friends to your Village so they can get your private daily updates and stay connected effortlessly!';

/**
 * Process notification for a single user with no friends
 */
const processUserNoFriendsNotification = async (
  db: FirebaseFirestore.Firestore,
  userId: string,
  profileData: FirebaseFirestore.DocumentData,
): Promise<InvitationNotificationEventParams> => {
  // Get the user's device
  const deviceDoc = await db.collection(Collections.DEVICES).doc(userId).get();
  if (!deviceDoc.exists) {
    logger.info(`No device found for user ${userId}`);
    return {
      has_friends: false,
      has_timestamp: true,
      profile_too_new: false,
      has_device: false,
    };
  }

  const deviceData = deviceDoc.data() || {};
  const deviceId = deviceData[DeviceFields.DEVICE_ID];
  if (!deviceId) {
    logger.info(`No device ID found for user ${userId}`);
    return {
      has_friends: false,
      has_timestamp: true,
      profile_too_new: false,
      has_device: false,
    };
  }

  // Check if the user has friends
  const friendsQuery = await db
    .collection(Collections.FRIENDSHIPS)
    .where(FriendshipFields.MEMBERS, QueryOperators.ARRAY_CONTAINS, userId)
    .limit(1)
    .get();

  if (!friendsQuery.empty) {
    logger.info(
      `User ${userId} has friends, skipping no-friends notification.`,
    );
    return {
      has_friends: true,
      has_timestamp: true,
      profile_too_new: false,
      has_device: true,
    };
  }

  // Check profile age
  const profileTimestamp =
    profileData[ProfileFields.CREATED_AT] ||
    profileData[ProfileFields.UPDATED_AT];
  if (!profileTimestamp) {
    logger.warn(`User ${userId} has no created_at or updated_at timestamp.`);
    return {
      has_friends: false,
      has_timestamp: false,
      profile_too_new: false,
      has_device: true,
    };
  }

  const profileAgeMs = Date.now() - profileTimestamp.toDate().getTime();
  const minProfileAgeMs = MIN_PROFILE_AGE_DAYS * 24 * 60 * 60 * 1000;

  if (profileAgeMs < minProfileAgeMs) {
    logger.info(
      `User ${userId} profile is too new (age: ${Math.floor(profileAgeMs / (24 * 60 * 60 * 1000))} days), skipping.`,
    );
    return {
      has_friends: false,
      has_timestamp: true,
      profile_too_new: true,
      has_device: true,
    };
  }

  // Send notification
  try {
    await sendNotification(deviceId, NOTIFICATION_TITLE, NOTIFICATION_BODY, {
      type: 'no_friends_reminder',
    });

    logger.info(`Successfully sent no-friends notification to user ${userId}.`);
    return {
      has_friends: false,
      has_timestamp: true,
      profile_too_new: false,
      has_device: true,
    };
  } catch (error) {
    logger.error(`Failed to send notification for user ${userId}`, error);
    return {
      has_friends: false,
      has_timestamp: true,
      profile_too_new: false,
      has_device: true,
    };
  }
};

/**
 * Process no-friends notifications for all eligible users.
 * This function is scheduled to run every three days.
 */
export const processInvitationNotifications = async (): Promise<void> => {
  const db = getFirestore();
  logger.info('Starting no-friends notification processing');

  // Stream all profiles
  const profilesStream = db
    .collection(Collections.PROFILES)
    .stream() as AsyncIterable<QueryDocumentSnapshot>;

  // Process all users and collect results
  const results: InvitationNotificationEventParams[] = [];
  for await (const profileDoc of profilesStream) {
    const profileData = profileDoc.data();
    let result: InvitationNotificationEventParams;
    try {
      result = await processUserNoFriendsNotification(
        db,
        profileDoc.id,
        profileData,
      );
    } catch (error) {
      logger.error(
        `Failed to process no-friends notification for user ${profileDoc.id}`,
        error,
      );
      result = {
        has_friends: false,
        has_timestamp: false,
        profile_too_new: false,
        has_device: false,
      };
    }
    results.push(result);
  }

  // Aggregate analytics data
  const totalUsers = results.length;
  const notifiedCount = results.filter(
    (r) =>
      !r.has_friends && r.has_timestamp && !r.profile_too_new && r.has_device,
  ).length;
  const hasFriendsCount = results.filter((r) => r.has_friends).length;
  const noTimestampCount = results.filter((r) => !r.has_timestamp).length;
  const profileTooNewCount = results.filter((r) => r.profile_too_new).length;
  const noDeviceCount = results.filter((r) => !r.has_device).length;

  // Create aggregate event
  const noFriendsNotifications: InvitationNotificationsEventParams = {
    total_users_count: totalUsers,
    notified_count: notifiedCount,
    has_friends_count: hasFriendsCount,
    no_timestamp_count: noTimestampCount,
    profile_too_new_count: profileTooNewCount,
    no_device_count: noDeviceCount,
  };

  // Track all events at once
  const events = [
    {
      eventName: EventName.INVITATION_NOTIFICATIONS_SENT,
      params: noFriendsNotifications,
    },
    ...results.map((result) => ({
      eventName: EventName.INVITATION_NOTIFICATION_SENT,
      params: result,
    })),
  ];

  trackApiEvents(events, SYSTEM_USER);
  logger.info(`Tracked ${events.length} analytics events`);

  logger.info('Completed no-friends notification processing');
};
