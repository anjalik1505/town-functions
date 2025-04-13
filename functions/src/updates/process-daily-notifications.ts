import { getFirestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { generateDailyNotificationFlow } from "../ai/flows";
import { Collections, DeviceFields } from "../models/constants";
import { getLogger } from "../utils/logging-utils";
import { calculateAge } from "../utils/profile-utils";

const logger = getLogger(__filename);

/**
 * Send a notification to a device
 */
const sendNotification = async (
    deviceId: string,
    title: string,
    message: string
): Promise<void> => {
    try {
        const messaging = getMessaging();

        await messaging.send({
            token: deviceId,
            notification: {
                title: title,
                body: message
            },
            data: {
                type: "daily"
            }
        });

        logger.info(`Successfully sent notification to device ${deviceId}`);
    } catch (error) {
        logger.error(`Error sending notification to device ${deviceId}: ${error}`);
    }
}

/**
 * Process notifications for a single user
 */
const processUserNotification = async (
    db: FirebaseFirestore.Firestore,
    userId: string,
    profileData: FirebaseFirestore.DocumentData
): Promise<void> => {
    // Get the user's device
    const deviceDoc = await db.collection(Collections.DEVICES).doc(userId).get();
    if (!deviceDoc.exists) {
        logger.info(`No device found for user ${userId}`);
        return;
    }

    const deviceData = deviceDoc.data() || {};
    const deviceId = deviceData[DeviceFields.DEVICE_ID];
    if (!deviceId) {
        logger.info(`No device ID found for user ${userId}`);
        return;
    }

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
    await sendNotification(deviceId, result.title, result.message);
}

/**
 * Process daily notifications for all users
 */
export const processDailyNotifications = async (): Promise<void> => {
    const db = getFirestore();
    logger.info("Starting daily notification processing");

    // Stream all profiles
    const profilesStream = db.collection(Collections.PROFILES).stream() as AsyncIterable<QueryDocumentSnapshot>;

    for await (const profileDoc of profilesStream) {
        const profileData = profileDoc.data();
        await processUserNotification(db, profileDoc.id, profileData);
    }

    logger.info("Completed daily notification processing");
} 