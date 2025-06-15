import { Timestamp, WriteBatch } from 'firebase-admin/firestore';
import { Collections, NudgingFields, ProfileFields, QueryOperators, TimeBucketFields } from '../models/constants.js';
import { getLogger } from './logging-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';
import { NudgingSettings } from '../models/data-models.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Calculates the appropriate time bucket for a given timezone.
 * The bucket is calculated to represent 9AM in the user's local time.
 * This function properly handles daylight saving time changes by using
 * the Intl.DateTimeFormat API which automatically accounts for DST.
 *
 * @param timezone - The timezone in Region/City format (e.g., Asia/Dubai)
 * @returns The bucket hour (0-23)
 */
export function calculateTimeBucket(timezone: string): number {
  try {
    // Create a date object for the current time
    const now = new Date();

    // Get the current UTC hour
    const utcHour = now.getUTCHours();

    // Format the date to get the current hour in the specified timezone
    // This automatically handles daylight saving time
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    };

    // Get the current hour in the specified timezone
    const formatter = new Intl.DateTimeFormat('en-US', options);
    const currentHour = parseInt(formatter.format(now), 10);

    // Calculate the timezone offset from UTC (in hours)
    // This includes any daylight saving time adjustments
    const timezoneOffset = (currentHour - utcHour + 24) % 24;

    // Calculate the bucket that corresponds to 9AM in the user's timezone
    // 9AM in their timezone corresponds to (9 - timezoneOffset) UTC
    // We add 24 and take modulo 24 to ensure we get a positive number between 0-23
    const bucket = (24 + (9 - timezoneOffset)) % 24;

    logger.info(
      `Timezone: ${timezone}, Current hour: ${currentHour}, UTC hour: ${utcHour}, Offset: ${timezoneOffset}, Bucket: ${bucket}`,
    );

    return bucket;
  } catch (error) {
    // If there's an error (e.g., invalid timezone), default to bucket 0
    logger.error(`Error calculating time bucket for timezone ${timezone}:`, error);
    return 0;
  }
}

/**
 * Updates time bucket membership for a user based on their nudging settings.
 * This function removes the user from all existing buckets and adds them to
 * new buckets based on their nudging settings (if not "never").
 *
 * @param userId - The user's ID
 * @param nudgingSettings - The user's nudging settings (or null/undefined)
 * @param batch - The Firestore batch to add operations to
 * @param db - The Firestore database instance (optional, will use getFirestore() if not provided)
 */
export async function updateTimeBucketMembership(
  userId: string,
  nudgingSettings: NudgingSettings,
  batch: WriteBatch,
  db: FirebaseFirestore.Firestore,
): Promise<void> {
  logger.info(`Updating time buckets for user ${userId}`);

  // Remove user from all existing buckets
  const existingBucketsQuery = await db
    .collectionGroup(Collections.TIME_BUCKET_USERS)
    .where(ProfileFields.USER_ID, QueryOperators.EQUALS, userId)
    .get();

  existingBucketsQuery.docs.forEach((doc) => {
    batch.delete(doc.ref);
    logger.info(`Removing user ${userId} from existing bucket ${doc.ref.parent.parent?.id}`);
  });

  // Add user to new buckets if nudging is not "never"
  if (nudgingSettings && nudgingSettings.occurrence !== NudgingFields.NEVER) {
    const { times_of_day, days_of_week } = nudgingSettings;

    if (times_of_day && days_of_week) {
      const currentTime = Timestamp.now();

      for (const time of times_of_day) {
        for (const day of days_of_week) {
          const bucketIdentifier = `${day}_${time}`;
          const bucketRef = db.collection(Collections.TIME_BUCKETS).doc(bucketIdentifier);

          // Check if the bucket document exists
          const bucketDoc = await bucketRef.get();

          if (!bucketDoc.exists) {
            // Create the main bucket document if it doesn't exist
            batch.set(bucketRef, {
              [TimeBucketFields.UPDATED_AT]: currentTime,
            });
          } else {
            // Update the timestamp on the main bucket document
            batch.update(bucketRef, {
              [TimeBucketFields.UPDATED_AT]: currentTime,
            });
          }

          // Add user to the bucket's users subcollection
          const userBucketRef = bucketRef.collection(Collections.TIME_BUCKET_USERS).doc(userId);

          batch.set(userBucketRef, {
            [ProfileFields.USER_ID]: userId,
            [ProfileFields.UPDATED_AT]: currentTime,
          });

          logger.info(`Adding user ${userId} to time bucket ${bucketIdentifier}`);
        }
      }
    }
  }
}
