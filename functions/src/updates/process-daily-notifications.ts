import { getFirestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { generateDailyNotificationFlow } from "../ai/flows";
import { DailyNotificationsEventParams, EventName, NotificationEventParams } from "../models/analytics-events";
import { Collections, DeviceFields, NotificationFields, ProfileFields } from "../models/constants";
import { trackApiEvents } from "../utils/analytics-utils";
import { getLogger } from "../utils/logging-utils";
import { sendNotification } from "../utils/notification-utils";
import { calculateAge } from "../utils/profile-utils";

const logger = getLogger(__filename);

/**
 * Process notifications for a single user
 */
const processUserNotification = async (
  db: FirebaseFirestore.Firestore,
  userId: string,
  profileData: FirebaseFirestore.DocumentData
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
      is_urgent: false
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
      is_urgent: false
    };
  }

  // Get notification settings from profile
  const notificationSettings = profileData[ProfileFields.NOTIFICATION_SETTINGS] || [];
  const hasAllSetting = notificationSettings.includes(NotificationFields.ALL);
  const hasUrgentSetting = notificationSettings.includes(NotificationFields.URGENT);

  // Get insights data
  const insightsRef = profileData.ref.collection(Collections.INSIGHTS).doc("default_insights");
  const insightsDoc = await insightsRef.get();
  const insightsData = insightsDoc.exists ? insightsDoc.data() || {} : {};

  // Generate personalized message
  const result = await generateDailyNotificationFlow({
    name: profileData.name || profileData.username || "Friend",
    existingSummary: profileData.summary || "",
    existingSuggestions: profileData.suggestions || "",
    existingEmotionalOverview: insightsData.emotional_overview || "",
    existingKeyMoments: insightsData.key_moments || "",
    existingRecurringThemes: insightsData.recurring_themes || "",
    existingProgressAndGrowth: insightsData.progress_and_growth || "",
    gender: profileData.gender || "unknown",
    location: profileData.location || "unknown",
    age: calculateAge(profileData.birthday || "")
  });

  // Send notification
  await sendNotification(deviceId, result.title, result.message, { type: "daily" });

  return {
    notification_all: hasAllSetting,
    notification_urgent: hasUrgentSetting,
    no_notification: notificationSettings.length === 0,
    no_device: false,
    notification_length: result.message.length,
    is_urgent: false
  };
}

/**
 * Process daily notifications for all users
 */
export const processDailyNotifications = async (): Promise<void> => {
  const db = getFirestore();
  logger.info("Starting daily notification processing");

  // Stream all profiles
  const profilesStream = db.collection(Collections.PROFILES).stream() as AsyncIterable<QueryDocumentSnapshot>;

  // Process all users and collect results
  const results: NotificationEventParams[] = [];
  for await (const profileDoc of profilesStream) {
    const profileData = profileDoc.data();
    const result = await processUserNotification(db, profileDoc.id, profileData);
    results.push(result);
  }

  // Aggregate analytics data
  const totalUsers = results.length;
  const notificationAllCount = results.filter(r => r.notification_all).length;
  const notificationUrgentCount = results.filter(r => r.notification_urgent).length;
  const noNotificationCount = results.filter(r => r.no_notification).length;
  const noDeviceCount = results.filter(r => r.no_device).length;

  // Create aggregate event
  const dailyNotifications: DailyNotificationsEventParams = {
    total_users_count: totalUsers,
    notification_all_count: notificationAllCount,
    notification_urgent_count: notificationUrgentCount,
    no_notification_count: noNotificationCount,
    no_device_count: noDeviceCount
  };

  // Track all events at once
  const events = [
    {
      eventName: EventName.DAILY_NOTIFICATIONS_SENT,
      params: dailyNotifications
    },
    ...results.map(result => ({
      eventName: EventName.DAILY_NOTIFICATION_SENT,
      params: result
    }))
  ];

  trackApiEvents(events, "system");
  logger.info(`Tracked ${events.length} analytics events`);

  logger.info("Completed daily notification processing");
} 