import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { generateDailyNotificationFlow } from '../ai/flows.js';
import { DailyNotificationsEventParams, EventName, NotificationEventParams } from '../models/analytics-events.js';
import {
  Collections,
  DaysOfWeek,
  DeviceFields,
  NotificationFields,
  NotificationTypes,
  NudgingFields,
  ProfileFields,
  QueryOperators,
  SYSTEM_USER,
  UpdateFields,
} from '../models/constants.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { sendNotification } from '../utils/notification-utils.js';
import { calculateAge } from '../utils/profile-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Process notifications for a single user
 */
const processUserNotification = async (
  db: FirebaseFirestore.Firestore,
  userId: string,
  profileData: FirebaseFirestore.DocumentData,
): Promise<NotificationEventParams> => {
  // Get the user's device
  const deviceDoc = await db.collection(Collections.DEVICES).doc(userId).get();
  if (!deviceDoc.exists) {
    logger.info(`No device found for user ${userId}`);
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
    logger.info(`No device ID found for user ${userId}`);
    return {
      notification_all: false,
      notification_urgent: false,
      no_notification: false,
      no_device: true,
      notification_length: 0,
      is_urgent: false,
    };
  }

  // Get notification settings from the profile
  const notificationSettings = profileData[ProfileFields.NOTIFICATION_SETTINGS] || [];
  const hasAllSetting = notificationSettings.includes(NotificationFields.ALL);
  const hasUrgentSetting = notificationSettings.includes(NotificationFields.URGENT);

  // Skip if the user created an update in the last 24 hours
  const recentSnapshot = await db
    .collection(Collections.UPDATES)
    .where(UpdateFields.CREATED_BY, QueryOperators.EQUALS, userId)
    .orderBy(UpdateFields.CREATED_AT, QueryOperators.DESC)
    .limit(1)
    .get();
  const lastDoc = recentSnapshot.docs[0];
  if (lastDoc) {
    const lastTimestamp = (lastDoc.data()[UpdateFields.CREATED_AT] as FirebaseFirestore.Timestamp).toDate().getTime();
    if (Date.now() - lastTimestamp < 24 * 60 * 60 * 1000) {
      logger.info(`Skipping daily notification for user ${userId} due to recent update`);
      return {
        notification_all: false,
        notification_urgent: false,
        no_notification: false,
        no_device: false,
        notification_length: 0,
        is_urgent: false,
      };
    }
  }

  // Generate and send notification with error handling
  try {
    const result = await generateDailyNotificationFlow({
      name: profileData.name || profileData.username || 'Friend',
      gender: profileData.gender || 'unknown',
      location: profileData.location || 'unknown',
      age: calculateAge(profileData.birthday || ''),
    });

    await sendNotification(deviceId, result.title, result.message, {
      type: NotificationTypes.DAILY,
    });

    return {
      notification_all: hasAllSetting,
      notification_urgent: hasUrgentSetting,
      no_notification: notificationSettings.length === 0,
      no_device: false,
      notification_length: result.message.length,
      is_urgent: false,
    };
  } catch (error) {
    logger.error(`Failed to generate/send notification for user ${userId}`, error);
    return {
      notification_all: false,
      notification_urgent: false,
      no_notification: false,
      no_device: false,
      notification_length: 0,
      is_urgent: false,
    };
  }
};

/**
 * Get current day of week and hour for time bucket identification
 */
const getCurrentTimeBucket = (): string => {
  const now = new Date();
  const dayIndex = now.getDay(); // 0 = Sunday, 1 = Monday, etc.

  // Map JavaScript day index to our enum values
  const dayMapping = [
    DaysOfWeek.SUNDAY, // 0
    DaysOfWeek.MONDAY, // 1
    DaysOfWeek.TUESDAY, // 2
    DaysOfWeek.WEDNESDAY, // 3
    DaysOfWeek.THURSDAY, // 4
    DaysOfWeek.FRIDAY, // 5
    DaysOfWeek.SATURDAY, // 6
  ];

  const dayName = dayMapping[dayIndex];
  const hour = now.getHours().toString().padStart(2, '0');
  const minute = '00'; // Always use :00 for hourly buckets
  return `${dayName}_${hour}:${minute}`;
};

/**
 * Process notifications for users in current time bucket
 */
const processTimeBucketNotifications = async (db: FirebaseFirestore.Firestore): Promise<NotificationEventParams[]> => {
  const currentBucket = getCurrentTimeBucket();
  logger.info(`Processing notifications for time bucket: ${currentBucket}`);

  const results: NotificationEventParams[] = [];

  try {
    // Stream users in the current time bucket
    const bucketUsersStream = db
      .collection(Collections.TIME_BUCKETS)
      .doc(currentBucket)
      .collection(Collections.TIME_BUCKET_USERS)
      .stream() as AsyncIterable<QueryDocumentSnapshot>;

    let userCount = 0;
    for await (const userDoc of bucketUsersStream) {
      userCount++;
      const userId = userDoc.id;

      try {
        // Get the user's profile
        const profileDoc = await db.collection(Collections.PROFILES).doc(userId).get();

        if (!profileDoc.exists) {
          logger.warn(`Profile not found for user ${userId} in bucket ${currentBucket}`);
          continue;
        }

        const profileData = profileDoc.data();
        if (!profileData) {
          logger.warn(`Profile data is empty for user ${userId} in bucket ${currentBucket}`);
          continue;
        }

        const result = await processUserNotification(db, userId, profileData);
        results.push(result);
      } catch (error) {
        logger.error(`Failed to process notification for user ${userId} in bucket ${currentBucket}`, error);
        results.push({
          notification_all: false,
          notification_urgent: false,
          no_notification: false,
          no_device: false,
          notification_length: 0,
          is_urgent: false,
        });
      }
    }

    logger.info(`Found ${userCount} users in bucket ${currentBucket}`);
  } catch (error) {
    logger.error(`Failed to process time bucket ${currentBucket}`, error);
  }

  return results;
};

/**
 * Process legacy notifications for users without nudge settings or timezone (backward compatibility)
 */
const processLegacyNotifications = async (db: FirebaseFirestore.Firestore): Promise<NotificationEventParams[]> => {
  logger.info('Processing legacy notifications for users without nudge settings or timezone');

  const results: NotificationEventParams[] = [];

  try {
    // Stream all profiles that don't have timezone or have nudge settings set to "never"
    const profilesStream = db.collection(Collections.PROFILES).stream() as AsyncIterable<QueryDocumentSnapshot>;

    for await (const profileDoc of profilesStream) {
      const profileData = profileDoc.data();
      const timezone = profileData[ProfileFields.TIMEZONE];
      const nudgingSettings = profileData[ProfileFields.NUDGING_SETTINGS];

      // Process users who don't have timezone or nudging settings configured
      // Users with occurrence "never" should NOT be notified
      const hasNeverOccurrence = nudgingSettings && nudgingSettings.occurrence === NudgingFields.NEVER;
      const shouldProcessLegacy = !timezone || !nudgingSettings;

      if (shouldProcessLegacy && !hasNeverOccurrence) {
        try {
          const result = await processUserNotification(db, profileDoc.id, profileData);
          results.push(result);
        } catch (error) {
          logger.error(`Failed to process legacy notification for user ${profileDoc.id}`, error);
          results.push({
            notification_all: false,
            notification_urgent: false,
            no_notification: false,
            no_device: false,
            notification_length: 0,
            is_urgent: false,
          });
        }
      }
    }
  } catch (error) {
    logger.error('Failed to process legacy notifications', error);
  }

  logger.info(`Processed ${results.length} legacy notifications`);
  return results;
};

/**
 * Process hourly notifications using time buckets, with legacy support at 14:00
 */
export const processDailyNotifications = async (): Promise<void> => {
  const db = getFirestore();
  const currentHour = new Date().getHours();
  const isLegacyHour = currentHour === 14; // 14:00 is the legacy time

  logger.info(`Starting hourly notification processing at hour ${currentHour}${isLegacyHour ? ' (legacy hour)' : ''}`);

  // Always process time bucket notifications
  const timeBucketResults = await processTimeBucketNotifications(db);

  // At 14:00, also process legacy notifications for backward compatibility
  const legacyResults = isLegacyHour ? await processLegacyNotifications(db) : [];

  // Combine all results
  const allResults = [...timeBucketResults, ...legacyResults];

  // Aggregate analytics data
  const totalUsers = allResults.length;
  const notificationAllCount = allResults.filter((r) => r.notification_all).length;
  const notificationUrgentCount = allResults.filter((r) => r.notification_urgent).length;
  const noNotificationCount = allResults.filter((r) => r.no_notification).length;
  const noDeviceCount = allResults.filter((r) => r.no_device).length;

  // Create aggregate event
  const dailyNotifications: DailyNotificationsEventParams = {
    total_users_count: totalUsers,
    notification_all_count: notificationAllCount,
    notification_urgent_count: notificationUrgentCount,
    no_notification_count: noNotificationCount,
    no_device_count: noDeviceCount,
  };

  // Track all events at once
  const events = [
    {
      eventName: EventName.DAILY_NOTIFICATIONS_SENT,
      params: dailyNotifications,
    },
    ...allResults.map((result) => ({
      eventName: EventName.DAILY_NOTIFICATION_SENT,
      params: result,
    })),
  ];

  trackApiEvents(events, SYSTEM_USER);
  logger.info(`Tracked ${events.length} analytics events`);

  logger.info(
    `Completed hourly notification processing: ${timeBucketResults.length} bucket users, ${legacyResults.length} legacy users`,
  );
};
