import { Request, Response } from 'express';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { NudgingOccurrence, pf } from '../models/firestore/profile-doc.js';
import { Timezone, TimezonePayload } from '../models/data-models.js';
import { getLogger } from '../utils/logging-utils.js';
import { getProfileDoc } from '../utils/profile-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';
import { updateTimeBucketMembership } from '../utils/timezone-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Updates the authenticated user's timezone and manages time bucket membership.
 *
 * This function:
 * 1. Updates the user's timezone in their profile
 * 2. If timezone changes and nudging settings exist (not "never"), manages time bucket membership
 * 3. Uses weekday + time identifiers for time buckets based on user's nudging settings
 * 4. Adds user to each bucket corresponding to their nudging days and times
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Timezone data including:
 *                - timezone: The user's timezone in Region/City format (e.g., Asia/Dubai)
 * @param res - The Express response object
 *
 * @returns A Timezone object containing the updated timezone information
 */
export const updateTimezone = async (req: Request, res: Response): Promise<void> => {
  const currentUserId = req.userId;
  logger.info(`Updating timezone for user ${currentUserId}`);

  // Get validated data from request
  const timezoneData = req.validated_params as TimezonePayload;
  const newTimezone = timezoneData.timezone;

  const currentTime = Timestamp.now();

  // Get the profile document
  const db = getFirestore();
  const { ref: profileRef, data: profileData } = await getProfileDoc(currentUserId);

  // Get current timezone if it exists
  const currentTimezone = profileData.timezone || '';

  // Get nudging settings from profile
  const nudgingSettings = profileData.nudging_settings;

  // Create a batch to ensure all database operations are atomic
  const batch = db.batch();

  // Update profile with new timezone
  batch.update(profileRef, {
    [pf('timezone')]: newTimezone,
    [pf('updated_at')]: currentTime,
  });

  // Handle time bucket membership if timezone has changed and nudging settings exist
  if (currentTimezone !== newTimezone && nudgingSettings && nudgingSettings.occurrence !== NudgingOccurrence.NEVER) {
    await updateTimeBucketMembership(currentUserId, nudgingSettings, newTimezone, batch, db);
  }

  // Always commit the batch (timezone update is always included)
  await batch.commit();
  logger.info(`Timezone update completed successfully for user ${currentUserId}`);

  // Create and return a Timezone object
  const timezone: Timezone = {
    timezone: newTimezone,
    updated_at: formatTimestamp(currentTime),
  };

  res.json(timezone);
};
