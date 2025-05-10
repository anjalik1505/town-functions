import { defineSecret } from 'firebase-functions/params';
import { onDocumentCreated, onDocumentDeleted, } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { app } from './app.js';
import { Collections } from './models/constants.js';
import { onFriendshipCreated } from './invitations/on-friendship-creation.js';
import { onProfileDeleted } from './own_profile/on-deletion.js';
import { onUpdateCreated } from './updates/on-creation.js';
import { onUpdateNotification } from './updates/on-notification.js';
import { processDailyNotifications } from './updates/process-daily-notifications.js';

// Define secrets
const geminiApiKey = defineSecret('GEMINI_API_KEY');
const ga4MeasurementId = defineSecret('GA4_MEASUREMENT_ID');
const ga4ApiSecret = defineSecret('GA4_API_SECRET');
const g4ClientId = defineSecret('GA4_SERVER_CLIENT_ID');

// Export the main HTTP API function with proper configuration
export const api = onRequest(
  {
    secrets: [geminiApiKey, ga4MeasurementId, ga4ApiSecret, g4ClientId],
  },
  app,
);

// Export the Firestore trigger function for new updates
export const process_update_creation = onDocumentCreated(
  {
    document: `${Collections.UPDATES}/{id}`,
    secrets: [geminiApiKey, ga4MeasurementId, ga4ApiSecret, g4ClientId],
  },
  (event) => onUpdateCreated(event),
);

// Export the Firestore trigger function for sending notifications on new updates
export const process_update_notification = onDocumentCreated(
  {
    document: `${Collections.UPDATES}/{id}`,
    secrets: [geminiApiKey, ga4MeasurementId, ga4ApiSecret, g4ClientId],
  },
  (event) => onUpdateNotification(event),
);

// Export the scheduled function for daily notifications
export const process_daily_notifications = onSchedule(
  {
    schedule: 'every day 14:00',
    secrets: [geminiApiKey, ga4MeasurementId, ga4ApiSecret, g4ClientId],
  },
  async () => {
    await processDailyNotifications();
  },
);

// Export the Firestore trigger function for profile deletion
export const process_profile_deletion = onDocumentDeleted(
  {
    document: `${Collections.PROFILES}/{id}`,
    secrets: [ga4MeasurementId, ga4ApiSecret, g4ClientId],
  },
  (event) => onProfileDeleted(event),
);

// Export the Firestore trigger function for friendship creation
export const process_friendship_creation = onDocumentCreated(
  {
    document: `${Collections.FRIENDSHIPS}/{id}`,
    secrets: [geminiApiKey, ga4MeasurementId, ga4ApiSecret, g4ClientId],
  },
  (event) => onFriendshipCreated(event),
);
