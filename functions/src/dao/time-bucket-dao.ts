import { Timestamp } from 'firebase-admin/firestore';
import { Collections, QueryOperators } from '../models/constants.js';
import { NudgingOccurrence, NudgingSettings, pf } from '../models/firestore/profile-doc.js';
import {
  timeBucketConverter,
  TimeBucketDoc,
  timeBucketUserConverter,
  TimeBucketUserDoc,
} from '../models/firestore/time-bucket-doc.js';
import { getLogger } from '../utils/logging-utils.js';
import { BaseDAO } from './base-dao.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Data Access Object for Time Bucket operations
 * Manages time buckets for nudging functionality
 */
export class TimeBucketDAO extends BaseDAO<TimeBucketDoc, TimeBucketUserDoc> {
  constructor() {
    super(Collections.TIME_BUCKETS, timeBucketConverter, Collections.TIME_BUCKET_USERS, timeBucketUserConverter);
  }

  /**
   * Removes a user from all time buckets
   * @param userId The user to remove from all buckets
   * @param batch Optional batch to add operations to (won't be committed if provided)
   */
  async removeUserFromAllBuckets(userId: string, batch?: FirebaseFirestore.WriteBatch): Promise<void> {
    const existingBucketsQuery = await this.db
      .collectionGroup(this.subcollection!)
      .withConverter(this.subconverter!)
      .where(pf('user_id'), QueryOperators.EQUALS, userId)
      .get();

    const batchToUse = batch || this.db.batch();
    existingBucketsQuery.docs.forEach((doc) => {
      batchToUse.delete(doc.ref);
      logger.info(`Removing user ${userId} from bucket ${doc.ref.parent.parent?.id}`);
    });

    // Only commit if we created our own batch
    if (!batch && existingBucketsQuery.docs.length > 0) {
      await batchToUse.commit();
    }
  }

  /**
   * Adds a user to time buckets based on their nudging settings
   * @param userId The user to add to buckets
   * @param nudgingSettings The user's nudging settings
   * @param timezone The user's timezone
   * @param batch Optional batch to add operations to (won't be committed if provided)
   */
  async addUserToBuckets(
    userId: string,
    nudgingSettings: NudgingSettings,
    timezone: string,
    batch?: FirebaseFirestore.WriteBatch,
  ): Promise<void> {
    if (!nudgingSettings || nudgingSettings.occurrence === NudgingOccurrence.NEVER) {
      logger.info(`User ${userId} has nudging disabled, skipping bucket assignment`);
      return;
    }

    const { times_of_day, days_of_week } = nudgingSettings;
    if (!times_of_day || !days_of_week) {
      logger.warn(`User ${userId} has incomplete nudging settings`);
      return;
    }

    const batchToUse = batch || this.db.batch();
    const currentTime = Timestamp.now();

    for (const time of times_of_day) {
      for (const day of days_of_week) {
        const bucketIdentifier = `${day}_${time}`;
        const bucketRef = this.db.collection(this.collection).withConverter(this.converter).doc(bucketIdentifier);

        // Check if the bucket document exists
        const bucketDoc = await bucketRef.get();

        if (!bucketDoc.exists) {
          // Create the main bucket document if it doesn't exist
          const bucketData: TimeBucketDoc = {
            bucket_hour: bucketIdentifier,
            updated_at: currentTime,
          };
          batchToUse.set(bucketRef, bucketData);
        } else {
          // Update the timestamp on the main bucket document
          batchToUse.update(bucketRef, {
            updated_at: currentTime,
          });
        }

        // Add user to the bucket's users subcollection
        const userBucketRef = bucketRef.collection(this.subcollection!).withConverter(this.subconverter!).doc(userId);

        const userBucketData: TimeBucketUserDoc = {
          user_id: userId,
          timezone: timezone || '',
          nudging_occurrence: nudgingSettings.occurrence,
          created_at: currentTime,
        };
        batchToUse.set(userBucketRef, userBucketData);

        logger.info(`Adding user ${userId} to time bucket ${bucketIdentifier}`);
      }
    }

    // Only commit if we created our own batch
    if (!batch) {
      await batchToUse.commit();
    }
  }

  /**
   * Updates a user's time bucket membership
   * Removes from all buckets and adds to new ones based on settings
   * @param userId The user to update
   * @param nudgingSettings The user's nudging settings
   * @param timezone The user's timezone
   * @param batch Optional batch to add operations to (won't be committed if provided)
   */
  async updateUserBuckets(
    userId: string,
    nudgingSettings: NudgingSettings,
    timezone: string,
    batch?: FirebaseFirestore.WriteBatch,
  ): Promise<void> {
    logger.info(`Updating time buckets for user ${userId}`);

    // Remove from all existing buckets
    await this.removeUserFromAllBuckets(userId, batch);

    // Add to new buckets if nudging is enabled
    await this.addUserToBuckets(userId, nudgingSettings, timezone, batch);
  }

  /**
   * Gets users in a specific time bucket
   */
  async getUsersInBucket(bucketIdentifier: string): Promise<TimeBucketUserDoc[]> {
    const bucketRef = this.db.collection(Collections.TIME_BUCKETS).doc(bucketIdentifier);
    const usersSnapshot = await bucketRef.collection(this.subcollection!).withConverter(this.subconverter!).get();

    return usersSnapshot.docs.map((doc) => doc.data());
  }
}
