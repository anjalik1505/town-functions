import { Request, Response } from 'express';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { Collections, ProfileFields, TimeBucketCollections, TimeBucketFields } from '../models/constants.js';
import { Timezone, TimezonePayload } from '../models/data-models.js';
import { getLogger } from '../utils/logging-utils.js';
import { getProfileDoc } from '../utils/profile-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';
import { calculateTimeBucket } from '../utils/timezone-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Updates the authenticated user's timezone and manages time bucket membership.
 *
 * This function:
 * 1. Updates the user's timezone in their profile
 * 2. Calculates the appropriate time bucket based on 9AM local time
 * 3. Manages the user's membership in time buckets
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
  const currentTimezone = profileData[ProfileFields.TIMEZONE] || '';

  // Calculate the time bucket for 9AM in the user's timezone
  const timeBucket = calculateTimeBucket(newTimezone);
  logger.info(`Calculated time bucket ${timeBucket} for timezone ${newTimezone}`);

  // Create a batch to ensure all database operations are atomic
  const batch = db.batch();

  // Update profile with new timezone
  batch.update(profileRef, {
    [ProfileFields.TIMEZONE]: newTimezone,
    [ProfileFields.UPDATED_AT]: currentTime,
  });

  // Handle time bucket membership if timezone has changed
  if (currentTimezone !== newTimezone) {
    // If user had a previous timezone, calculate its bucket
    if (currentTimezone) {
      const previousTimeBucket = calculateTimeBucket(currentTimezone);

      // Only process if the time bucket has changed
      if (previousTimeBucket !== timeBucket) {
        // Remove user from previous bucket
        const previousUserBucketRef = db
          .collection(Collections.TIME_BUCKETS)
          .doc(previousTimeBucket.toString())
          .collection(TimeBucketCollections.USERS)
          .doc(currentUserId);

        batch.delete(previousUserBucketRef);
        logger.info(`Removing user ${currentUserId} from previous time bucket ${previousTimeBucket}`);
      }
    }

    // Add user to the new time bucket
    const bucketRef = db.collection(Collections.TIME_BUCKETS).doc(timeBucket.toString());

    // Check if the bucket document exists
    const bucketDoc = await bucketRef.get();

    if (!bucketDoc.exists) {
      // Create the main bucket document if it doesn't exist
      batch.set(bucketRef, {
        [TimeBucketFields.BUCKET_HOUR]: timeBucket,
        [TimeBucketFields.UPDATED_AT]: currentTime,
      });
    } else {
      // Update the timestamp on the main bucket document
      batch.update(bucketRef, {
        [TimeBucketFields.UPDATED_AT]: currentTime,
      });
    }

    // Add user to the bucket's users subcollection
    const userBucketRef = bucketRef.collection(TimeBucketCollections.USERS).doc(currentUserId);

    batch.set(userBucketRef, {
      user_id: currentUserId,
      updated_at: currentTime,
    });

    logger.info(`Adding user ${currentUserId} to time bucket ${timeBucket}`);
  }

  // Commit the batch
  await batch.commit();
  logger.info(`Batch operation completed successfully for user ${currentUserId}`);

  // Create and return a Timezone object
  const timezone: Timezone = {
    timezone: newTimezone,
    updated_at: formatTimestamp(currentTime),
  };

  res.json(timezone);
};
