import { Request, Response } from "express";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { Collections, DeviceFields } from "../models/constants";
import { NotificationResponse } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";

const logger = getLogger(__filename);

/**
 * Sends a test notification to the user's device.
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: The validated request parameters containing:
 *                - title: The notification title
 *                - body: The notification body text
 * @param res - The Express response object
 * 
 * @returns A NotificationResponse if the notification was sent successfully
 * 
 * @throws {404} Device not found
 */
export const testNotification = async (req: Request, res: Response): Promise<void> => {
    const currentUserId = req.userId;
    logger.info(`Sending test notification to user ${currentUserId}`);

    // Get validated data from request
    const { title, body } = req.validated_params;

    // Initialize Firestore client
    const db = getFirestore();

    // Get the user's device token
    const deviceRef = db.collection(Collections.DEVICES).doc(currentUserId);
    const deviceDoc = await deviceRef.get();

    if (!deviceDoc.exists) {
        logger.warn(`Device not found for user ${currentUserId}`);
        res.status(404).json({
            code: 404,
            name: "Not Found",
            description: "Device not found. Please register a device first."
        });
    }

    const deviceData = deviceDoc.data();
    const deviceToken = deviceData?.[DeviceFields.DEVICE_ID];

    if (!deviceToken) {
        logger.warn(`No device token found for user ${currentUserId}`);
        res.status(404).json({
            code: 404,
            name: "Not Found",
            description: "Device token not found. Please register a device first."
        });
    }

    // Initialize Firebase Messaging
    const messaging = getMessaging();

    // Send the notification
    const message = {
        notification: {
            title,
            body
        },
        token: deviceToken
    };

    const response = await messaging.send(message);
    logger.info(`Successfully sent notification to user ${currentUserId}: ${response}`);

    const notificationResponse: NotificationResponse = {
        success: true,
        message: "Notification sent successfully",
        messageId: response
    };

    res.json(notificationResponse);
}; 