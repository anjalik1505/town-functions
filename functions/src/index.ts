import { defineSecret } from 'firebase-functions/params';
import { setGlobalOptions } from 'firebase-functions/v2';
import { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { app } from './app.js';
import { Collections } from './models/constants.js';
import { onCommentCreated } from './triggers/on-comment-creation.js';
import { onFriendshipCreated } from './triggers/on-friendship-creation.js';
import { onJoinRequestCreated } from './triggers/on-join-request-creation.js';
import { onJoinRequestUpdated } from './triggers/on-join-request-update.js';
import { onProfileDeleted } from './triggers/on-profile-deletion.js';
import { onProfileUpdate } from './triggers/on-profile-update.js';
import { onReactionCreated } from './triggers/on-reaction-creation.js';
import { onUpdateCreated } from './triggers/on-update-creation.js';
import { onUpdateUpdated } from './triggers/on-update-update.js';
import { processDailyNotifications } from './triggers/process-daily-notifications.js';
import { processInvitationNotifications } from './triggers/process-invitation-notifications.js';

// Set global options for all functions
setGlobalOptions({
  region: 'europe-west1',
  memory: '256MiB',
  timeoutSeconds: 60,
  maxInstances: 20,
  minInstances: 0
});

// Define secrets
const geminiApiKey = defineSecret('GEMINI_API_KEY');
const ga4MeasurementId = defineSecret('GA4_MEASUREMENT_ID');
const ga4ApiSecret = defineSecret('GA4_API_SECRET');
const g4ClientId = defineSecret('GA4_SERVER_CLIENT_ID');

// Export the main HTTP API function with the proper configuration
export const api = onRequest(
  {
    secrets: [geminiApiKey, ga4MeasurementId, ga4ApiSecret, g4ClientId],
  },
  app,
);

// Export the Firestore trigger function for new updates (includes notifications)
export const process_update_creation = onDocumentCreated(
  {
    document: `${Collections.UPDATES}/{updateId}`,
    secrets: [geminiApiKey, ga4MeasurementId, ga4ApiSecret, g4ClientId],
  },
  (event) => onUpdateCreated(event),
);

// Export the scheduled function for daily notifications
export const process_daily_notifications = onSchedule(
  {
    schedule: 'every hour',
    memory: '512MiB',
    timeoutSeconds: 540,
    secrets: [geminiApiKey, ga4MeasurementId, ga4ApiSecret, g4ClientId],
  },
  async () => {
    await processDailyNotifications();
  },
);

// Export the scheduled function for no-friends notifications
export const process_no_friends_notifications = onSchedule(
  {
    schedule: '0 12 */3 * *',
    memory: '512MiB',
    timeoutSeconds: 540,
    secrets: [ga4MeasurementId, ga4ApiSecret, g4ClientId],
  },
  async () => {
    await processInvitationNotifications();
  },
);

// Export the Firestore trigger function for profile deletion
export const process_profile_deletion = onDocumentDeleted(
  {
    document: `${Collections.PROFILES}/{userId}`,
    memory: '512MiB',
    timeoutSeconds: 540,
    secrets: [ga4MeasurementId, ga4ApiSecret, g4ClientId],
  },
  (event) => onProfileDeleted(event),
);

// Export the Firestore trigger function for profile updates
export const process_profile_update = onDocumentUpdated(
  {
    document: `${Collections.PROFILES}/{userId}`,
    memory: '512MiB',
    timeoutSeconds: 540,
    secrets: [ga4MeasurementId, ga4ApiSecret, g4ClientId],
  },
  (event) => onProfileUpdate(event),
);

// Export the Firestore trigger function for friendship creation
export const process_friendship_creation = onDocumentCreated(
  {
    document: `${Collections.PROFILES}/{userId}/${Collections.FRIENDS}/{friendId}`,
    memory: '512MiB',
    timeoutSeconds: 540,
    secrets: [geminiApiKey, ga4MeasurementId, ga4ApiSecret, g4ClientId],
  },
  (event) => onFriendshipCreated(event),
);

// Export the Firestore trigger function for comment creation
export const process_comment_notification = onDocumentCreated(
  {
    document: `${Collections.UPDATES}/{updateId}/${Collections.COMMENTS}/{commentId}`,
    secrets: [ga4MeasurementId, ga4ApiSecret, g4ClientId],
  },
  (event) => onCommentCreated(event),
);

// Export the Firestore trigger function for reaction creation
export const process_reaction_notification = onDocumentCreated(
  {
    document: `${Collections.UPDATES}/{updateId}/${Collections.REACTIONS}/{reactionId}`,
    secrets: [ga4MeasurementId, ga4ApiSecret, g4ClientId],
  },
  (event) => onReactionCreated(event),
);

// Export the Firestore trigger function for join request creation
export const process_join_request_notification = onDocumentCreated(
  {
    document: `${Collections.INVITATIONS}/{invitationId}/${Collections.JOIN_REQUESTS}/{joinRequestId}`,
    secrets: [ga4MeasurementId, ga4ApiSecret, g4ClientId],
  },
  (event) => onJoinRequestCreated(event),
);

// Export the Firestore trigger function for join request update
export const process_join_request_update_notification = onDocumentUpdated(
  {
    document: `${Collections.INVITATIONS}/{invitationId}/${Collections.JOIN_REQUESTS}/{joinRequestId}`,
    secrets: [ga4MeasurementId, ga4ApiSecret, g4ClientId],
  },
  (event) => onJoinRequestUpdated(event),
);

// Export the Firestore trigger function for update sharing
export const process_update_share = onDocumentUpdated(
  {
    document: `${Collections.UPDATES}/{updateId}`,
    secrets: [geminiApiKey, ga4MeasurementId, ga4ApiSecret, g4ClientId],
  },
  (event) => onUpdateUpdated(event),
);
