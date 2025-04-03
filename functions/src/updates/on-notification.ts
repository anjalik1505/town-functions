import { getFirestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { FirestoreEvent } from "firebase-functions/v2/firestore";
import { determineUrgencyFlow, generateNotificationMessageFlow } from "../ai/flows";
import { Collections, DeviceFields, NotificationFields, ProfileFields, UpdateFields } from "../models/constants";
import { getLogger } from "../utils/logging-utils";

const logger = getLogger(__filename);

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
 */
const processUserNotification = async (
    db: FirebaseFirestore.Firestore,
    updateData: Record<string, any>,
    creatorId: string,
    targetUserId: string,
    creatorName: string,
    creatorGender: string,
    creatorLocation: string
): Promise<void> => {
    // Skip if the target user is the creator
    if (targetUserId === creatorId) {
        logger.info(`Skipping notification for creator: ${creatorId}`);
        return;
    }

    // Get the user's profile to check notification settings
    const profileRef = db.collection(Collections.PROFILES).doc(targetUserId);
    const profileDoc = await profileRef.get();

    if (!profileDoc.exists) {
        logger.warn(`Profile not found for user ${targetUserId}`);
        return;
    }

    // Get notification settings from profile
    const profileData = profileDoc.data() || {};
    const notificationSettings = profileData[ProfileFields.NOTIFICATION_SETTINGS] || [];

    // If user has no notification settings, skip
    if (!notificationSettings || notificationSettings.length === 0) {
        logger.info(`User ${targetUserId} has no notification settings, skipping notification`);
        return;
    }

    // Get the user's device ID
    const deviceRef = db.collection(Collections.DEVICES).doc(targetUserId);
    const deviceDoc = await deviceRef.get();

    if (!deviceDoc.exists) {
        logger.info(`No device found for user ${targetUserId}, skipping notification`);
        return;
    }

    const deviceData = deviceDoc.data() || {};
    const deviceId = deviceData[DeviceFields.DEVICE_ID];

    if (!deviceId) {
        logger.info(`No device ID found for user ${targetUserId}, skipping notification`);
        return;
    }

    // Extract update content and sentiment
    const updateContent = updateData[UpdateFields.CONTENT];
    const sentiment = updateData[UpdateFields.SENTIMENT];
    const updateId = updateData[UpdateFields.ID];

    // Determine if we should send a notification based on user settings
    let shouldSendNotification = false;

    if (notificationSettings.includes(NotificationFields.ALL)) {
        // User wants all notifications
        shouldSendNotification = true;
        logger.info(`User ${targetUserId} has 'all' notification setting, will send notification`);
    } else if (notificationSettings.includes(NotificationFields.URGENT)) {
        // User only wants urgent notifications, check if this update is urgent
        const urgencyResult = await determineUrgencyFlow({
            updateContent: updateContent || "",
            sentiment: sentiment || "",
            creatorName: creatorName,
            creatorGender: creatorGender,
            creatorLocation: creatorLocation
        });

        if (urgencyResult.is_urgent) {
            shouldSendNotification = true;
            logger.info(`Update ${updateId} is urgent for user ${targetUserId}, will send notification`);
        } else {
            logger.info(`Update ${updateId} is not urgent for user ${targetUserId}, skipping notification`);
        }
    } else {
        logger.info(`User ${targetUserId} has notification settings that don't include 'all' or 'urgent', skipping notification`);
    }

    // If we should send a notification, generate the message and send it
    if (shouldSendNotification) {
        // Generate notification message
        const result = await generateNotificationMessageFlow({
            updateContent: updateContent || "",
            sentiment: sentiment || "",
            creatorName: creatorName,
            creatorGender: creatorGender,
            creatorLocation: creatorLocation
        });

        // Send the notification
        await sendNotification(deviceId, result.message, updateId);

        logger.info(`Sent notification to user ${targetUserId} for update ${updateId}`);
    }
}

/**
 * Send a notification to a device.
 * 
 * @param deviceId - The device ID to send the notification to
 * @param message - The notification message
 * @param updateId - The ID of the update
 */
const sendNotification = async (
    deviceId: string,
    message: string,
    updateId: string
): Promise<void> => {
    try {
        const messaging = getMessaging();

        await messaging.send({
            token: deviceId,
            notification: {
                title: "New Update",
                body: message
            },
            data: {
                update_id: updateId,
                type: "update"
            }
        });

        logger.info(`Successfully sent notification to device ${deviceId}`);
    } catch (error) {
        logger.error(`Error sending notification to device ${deviceId}: ${error}`);
    }
}

/**
 * Process notifications for all users who should receive the update.
 * 
 * @param db - Firestore client
 * @param updateData - The update document data
 */
const processAllNotifications = async (
    db: FirebaseFirestore.Firestore,
    updateData: Record<string, any>
): Promise<void> => {
    // Get the creator ID and friend IDs
    const creatorId = updateData[UpdateFields.CREATED_BY];
    const friendIds = updateData[UpdateFields.FRIEND_IDS] || [];
    const groupIds = updateData[UpdateFields.GROUP_IDS] || [];

    if (!creatorId) {
        logger.error("Update has no creator ID");
        return;
    }

    // Get the creator's profile information
    const creatorProfileRef = db.collection(Collections.PROFILES).doc(creatorId);
    const creatorProfileDoc = await creatorProfileRef.get();

    let creatorName = "Friend";
    let creatorGender = "They";
    let creatorLocation = "";

    if (creatorProfileDoc.exists) {
        const creatorProfileData = creatorProfileDoc.data() || {};
        creatorName = creatorProfileData[ProfileFields.NAME] ||
            creatorProfileData[ProfileFields.USERNAME] ||
            "Friend";
        creatorGender = creatorProfileData[ProfileFields.GENDER] || "They";
        creatorLocation = creatorProfileData[ProfileFields.LOCATION] || "";
    } else {
        logger.warn(`Creator profile not found: ${creatorId}`);
    }

    // Create a set of all users who should receive the update
    const usersToNotify = new Set<string>();

    // Add all friends
    friendIds.forEach((friendId: string) => usersToNotify.add(friendId));

    // Get all group members if there are groups
    if (groupIds.length > 0) {
        const groupDocs = await Promise.all(
            groupIds.map((groupId: string) =>
                db.collection(Collections.GROUPS).doc(groupId).get()
            )
        );

        groupDocs.forEach(groupDoc => {
            if (groupDoc.exists) {
                const groupData = groupDoc.data();
                if (groupData && groupData.members) {
                    groupData.members.forEach((memberId: string) => usersToNotify.add(memberId));
                }
            }
        });
    }

    // Process notifications for all users in parallel
    const tasks = Array.from(usersToNotify).map(userId =>
        processUserNotification(
            db,
            updateData,
            creatorId,
            userId,
            creatorName,
            creatorGender,
            creatorLocation
        )
    );

    // Run all tasks in parallel
    await Promise.all(tasks);
    logger.info(`Processed notifications for ${tasks.length} users`);
}

/**
 * Firestore trigger function that runs when a new update is created.
 * 
 * @param event - The Firestore event object containing the document data
 */
export const onUpdateNotification = async (event: FirestoreEvent<QueryDocumentSnapshot | undefined, { id: string }>): Promise<void> => {
    if (!event.data) {
        logger.error("No data in update event");
        return;
    }

    logger.info(`Processing notifications for update: ${event.data.id}`);

    // Get the update data directly from the event
    const updateData = event.data.data() || {};

    // Add the document ID to the update data
    updateData[UpdateFields.ID] = event.data.id;

    // Check if the update has the required fields
    if (!updateData || Object.keys(updateData).length === 0) {
        logger.error(`Update ${updateData[UpdateFields.ID] || "unknown"} has no data`);
        return;
    }

    // Initialize Firestore client
    const db = getFirestore();

    try {
        await processAllNotifications(db, updateData);
        logger.info(`Successfully processed notifications for update ${updateData[UpdateFields.ID] || "unknown"}`);
    } catch (error) {
        logger.error(`Error processing notifications for update ${updateData[UpdateFields.ID] || "unknown"}: ${error}`);
        // In a production environment, we would implement retry logic here
    }
} 