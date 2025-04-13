import { defineSecret } from 'firebase-functions/params';
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { app } from "./app";
import { Collections } from "./models/constants";
import { onUpdateCreated } from "./updates/on-creation";
import { onUpdateNotification } from "./updates/on-notification";
import { processDailyNotifications } from "./updates/process-daily-notifications";

// Define the API key secret for Gemini
const geminiApiKey = defineSecret("GEMINI_API_KEY");

// Export the main HTTP API function with proper configuration
export const api = onRequest({
  secrets: [geminiApiKey],
}, app);

// Export the Firestore trigger function for new updates
export const process_update_creation = onDocumentCreated(
  {
    document: `${Collections.UPDATES}/{id}`,
    secrets: [geminiApiKey],
  },
  (event) => onUpdateCreated(event)
);

// Export the Firestore trigger function for sending notifications on new updates
export const process_update_notification = onDocumentCreated(
  {
    document: `${Collections.UPDATES}/{id}`,
    secrets: [geminiApiKey],
  },
  (event) => onUpdateNotification(event)
);

// Export the scheduled function for daily notifications
export const process_daily_notifications = onSchedule("every day 14:00", async () => {
  await processDailyNotifications();
});
