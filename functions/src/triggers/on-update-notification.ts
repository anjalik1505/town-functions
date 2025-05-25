import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FirestoreEvent } from 'firebase-functions/v2/firestore';
import { generateNotificationMessageFlow } from '../ai/flows.js';
import { EventName, NotificationEventParams, NotificationsEventParams } from '../models/analytics-events.js';
import { Collections, DeviceFields, NotificationFields, ProfileFields, UpdateFields } from '../models/constants.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { sendNotification } from '../utils/notification-utils.js';
import { calculateAge } from '../utils/profile-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Process notifications for a specific user.
 *
 * @param db - Firestore client
 * @param updateData - The update document data
 * @param creatorId - The ID of the user who created the update
 * @param targetUserId - The ID of the user to send the notification to
 * @param creatorName - The name of the creator
 * @param creatorGender - The gender of the creator
 * @param creatorLocation - The location of the creator
 * @param creatorBirthday - The birthday of the creator
 * @returns Analytics data for this user's notification processing
 */
const processUserNotification = async (
  db: FirebaseFirestore.Firestore,
  updateData: Record<string, unknown>,
  creatorId: string,
  targetUserId: string,
  creatorName: string,
  creatorGender: string,
  creatorLocation: string,
  creatorBirthday: string,
): Promise<NotificationEventParams> => {
  // Skip if the target user is the creator
  if (targetUserId === creatorId) {
    logger.info(`Skipping notification for creator: ${creatorId}`);
    return {
      notification_all: false,
      notification_urgent: false,
      no_notification: false,
      no_device: false,
      notification_length: 0,
      is_urgent: false,
    };
  }

  // Get the user's profile to check notification settings
  const profileRef = db.collection(Collections.PROFILES).doc(targetUserId);
  const profileDoc = await profileRef.get();

  if (!profileDoc.exists) {
    logger.warn(`Profile not found for user ${targetUserId}`);
    return {
      notification_all: false,
      notification_urgent: false,
      no_notification: false,
      no_device: false,
      notification_length: 0,
      is_urgent: false,
    };
  }

  // Get notification settings from the profile
  const profileData = profileDoc.data() || {};
  const notificationSettings = profileData[ProfileFields.NOTIFICATION_SETTINGS] || [];

  // If the user has no notification settings, skip
  if (!notificationSettings || notificationSettings.length === 0) {
    logger.info(`User ${targetUserId} has no notification settings, skipping notification`);
    return {
      notification_all: false,
      notification_urgent: false,
      no_notification: true,
      no_device: false,
      notification_length: 0,
      is_urgent: false,
    };
  }

  // Get the user's device ID
  const deviceRef = db.collection(Collections.DEVICES).doc(targetUserId);
  const deviceDoc = await deviceRef.get();

  if (!deviceDoc.exists) {
    logger.info(`No device found for user ${targetUserId}, skipping notification`);
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
    logger.info(`No device ID found for user ${targetUserId}, skipping notification`);
    return {
      notification_all: false,
      notification_urgent: false,
      no_notification: false,
      no_device: true,
      notification_length: 0,
      is_urgent: false,
    };
  }

  // Extract update content and sentiment
  const updateContent = updateData[UpdateFields.CONTENT] as string;
  const sentiment = updateData[UpdateFields.SENTIMENT] as string;
  const updateId = updateData[UpdateFields.ID] as string;
  const score = (updateData[UpdateFields.SCORE] as number) || 3;

  // Determine if we should send a notification based on user settings
  let shouldSendNotification = false;
  let userAll = false;
  let userUrgent = false;

  if (notificationSettings.includes(NotificationFields.ALL)) {
    // User wants all notifications
    shouldSendNotification = true;
    userAll = true;
    logger.info(`User ${targetUserId} has 'all' notification setting, will send notification`);
  } else if (notificationSettings.includes(NotificationFields.URGENT) && (score === 5 || score === 1)) {
    // User only wants urgent notifications, check if this update is urgent
    shouldSendNotification = true;
    userUrgent = true;
    logger.info(`User ${targetUserId} has 'urgent' notification setting, will send notification`);
  } else {
    logger.info(
      `User ${targetUserId} has notification settings that don't include 'all' or 'urgent', skipping notification`,
    );
  }

  // If we should send a notification, generate the message and send it
  if (shouldSendNotification) {
    // Calculate creator's age
    const creatorAge = calculateAge(creatorBirthday || '');

    try {
      const result = await generateNotificationMessageFlow({
        updateContent: updateContent || '',
        sentiment: sentiment || '',
        score: score.toString(),
        friendName: creatorName,
        friendGender: creatorGender,
        friendLocation: creatorLocation,
        friendAge: creatorAge,
      });

      await sendNotification(deviceId, 'New Update', result.message, {
        type: 'update',
        update_id: updateId,
      });

      logger.info(`Sent notification to user ${targetUserId} for update ${updateId}`);
    } catch (error) {
      logger.error(`Failed to generate/send notification to user ${targetUserId} for update ${updateId}`, error);
      return {
        notification_all: false,
        notification_urgent: false,
        no_notification: false,
        no_device: false,
        notification_length: 0,
        is_urgent: score === 5 || score === 1,
      };
    }
  }

  return {
    notification_all: userAll,
    notification_urgent: userUrgent,
    no_notification: false,
    no_device: false,
    notification_length: updateContent?.length || 0,
    is_urgent: score === 5 || score === 1,
  };
};

/**
 * Process notifications for all users who should receive the update.
 *
 * @param db - Firestore client
 * @param updateData - The update document data
 * @returns Analytics data about the notification processing
 */
const processAllNotifications = async (
  db: FirebaseFirestore.Firestore,
  updateData: Record<string, unknown>,
): Promise<{
  notifications: NotificationsEventParams;
  notificationEvents: NotificationEventParams[];
}> => {
  // Get the creator ID and friend IDs
  const creatorId = updateData[UpdateFields.CREATED_BY] as string;
  const friendIds = (updateData[UpdateFields.FRIEND_IDS] as string[]) || [];
  const groupIds = (updateData[UpdateFields.GROUP_IDS] as string[]) || [];

  if (!creatorId) {
    logger.error('Update has no creator ID');
    return {
      notifications: {
        total_users_count: 0,
        notification_all_account: 0,
        notification_urgent_count: 0,
        no_notification_count: 0,
        friend_count: 0,
        group_count: 0,
        no_device_count: 0,
        is_urgent: false,
      },
      notificationEvents: [],
    };
  }

  // Get the creator's profile information
  const creatorProfileRef = db.collection(Collections.PROFILES).doc(creatorId);
  const creatorProfileDoc = await creatorProfileRef.get();

  let creatorName = 'Friend';
  let creatorGender = 'They';
  let creatorLocation = '';
  let creatorBirthday = '';

  if (creatorProfileDoc.exists) {
    const creatorProfileData = creatorProfileDoc.data() || {};
    creatorName = creatorProfileData[ProfileFields.NAME] || creatorProfileData[ProfileFields.USERNAME] || 'Friend';
    creatorGender = creatorProfileData[ProfileFields.GENDER] || 'They';
    creatorLocation = creatorProfileData[ProfileFields.LOCATION] || '';
    creatorBirthday = creatorProfileData[ProfileFields.BIRTHDAY] || '';
  } else {
    logger.warn(`Creator profile not found: ${creatorId}`);
  }

  // Create a set of all users who should receive the update
  const usersToNotify = new Set<string>();
  const groupUsers = new Set<string>();

  // Add all friends
  friendIds.forEach((friendId: string) => usersToNotify.add(friendId));

  // Get all group members if there are groups
  if (groupIds.length > 0) {
    const groupDocs = await Promise.all(
      groupIds.map((groupId: string) => db.collection(Collections.GROUPS).doc(groupId).get()),
    );

    groupDocs.forEach((groupDoc) => {
      if (groupDoc.exists) {
        const groupData = groupDoc.data();
        if (groupData && groupData.members) {
          groupData.members.forEach((memberId: string) => {
            usersToNotify.add(memberId);
            groupUsers.add(memberId);
          });
        }
      }
    });
  }

  // Process notifications for all users in parallel
  const tasks = Array.from(usersToNotify).map((userId) =>
    processUserNotification(
      db,
      updateData,
      creatorId,
      userId,
      creatorName,
      creatorGender,
      creatorLocation,
      creatorBirthday,
    ).catch((error) => {
      logger.error(`Failed to process notification for user ${userId} update ${updateData[UpdateFields.ID]}`, error);
      return {
        notification_all: false,
        notification_urgent: false,
        no_notification: false,
        no_device: false,
        notification_length: 0,
        is_urgent: false,
      };
    }),
  );

  // Run all tasks in parallel and collect results
  const results = await Promise.all(tasks);

  // Aggregate analytics data
  const userAllCount = results.filter((r) => r.notification_all).length;
  const usersUrgentCount = results.filter((r) => r.notification_urgent).length;
  const noDeviceCount = results.filter((r) => r.no_device).length;
  const noNotificationCount = results.filter((r) => r.no_notification).length;
  const score = updateData[UpdateFields.SCORE] || 3;
  const isUrgent = score === 5 || score === 1;

  // Return analytics data
  return {
    notifications: {
      total_users_count: usersToNotify.size,
      notification_all_account: userAllCount,
      notification_urgent_count: usersUrgentCount,
      no_notification_count: noNotificationCount,
      friend_count: friendIds.length,
      group_count: groupUsers.size,
      no_device_count: noDeviceCount,
      is_urgent: isUrgent,
    },
    notificationEvents: results,
  };
};

/**
 * Firestore trigger function that runs when a new update is created.
 *
 * @param event - The Firestore event object containing the document data
 */
export const onUpdateNotification = async (
  event: FirestoreEvent<
    QueryDocumentSnapshot | undefined,
    {
      id: string;
    }
  >,
): Promise<void> => {
  if (!event.data) {
    logger.error('No data in update event');
    return;
  }

  logger.info(`Processing notifications for update: ${event.data.id}`);

  // Get the update data directly from the event
  const updateData = event.data.data() || {};

  // Add the document ID to the update data
  updateData[UpdateFields.ID] = event.data.id;

  // Check if the update has the required fields
  if (!updateData || Object.keys(updateData).length === 0) {
    logger.error(`Update ${updateData[UpdateFields.ID] || 'unknown'} has no data`);
    return;
  }

  // Initialize Firestore client
  const db = getFirestore();

  try {
    const { notifications, notificationEvents } = await processAllNotifications(db, updateData);
    logger.info(`Successfully processed notifications for update ${updateData[UpdateFields.ID] || 'unknown'}`);

    // Track all events at once
    const events = [
      {
        eventName: EventName.NOTIFICATION_SENT,
        params: notifications,
      },
      ...notificationEvents.map((event) => ({
        eventName: EventName.NOTIFICATION_SENT,
        params: event,
      })),
    ];

    trackApiEvents(events, updateData[UpdateFields.CREATED_BY]);

    logger.info(`Tracked ${events.length} analytics events`);
  } catch (error) {
    logger.error(`Error processing notifications for update ${updateData[UpdateFields.ID] || 'unknown'}: ${error}`);
    // In a production environment, we would implement retry logic here
  }
};
