import { Timestamp } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { ProfileDAO } from '../dao/profile-dao.js';
import { TimeBucketDAO } from '../dao/time-bucket-dao.js';
import { ProfileDoc } from '../models/firestore/index.js';
import { getLogger } from '../utils/logging-utils.js';
import { getCurrentTimeBucket } from '../utils/timezone-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Service layer for Profile Activity operations
 * Handles user activity tracking for notification purposes
 * Separated from ProfileService to focus on notification-related activity tracking
 */
export class ProfileActivityService {
  private profileDAO: ProfileDAO;
  private timeBucketDAO: TimeBucketDAO;

  constructor() {
    this.profileDAO = new ProfileDAO();
    this.timeBucketDAO = new TimeBucketDAO();
  }

  /**
   * Gets users eligible for daily notifications from current time bucket
   * Filters out users who have posted in the last 24 hours
   * @returns Array of ProfileDoc objects for users eligible for notifications
   */
  async getUsersForDailyNotifications(): Promise<ProfileDoc[]> {
    logger.info('Getting users for daily notifications');

    // Calculate current time bucket using unified timezone utils
    const currentBucket = getCurrentTimeBucket();

    logger.info(`Processing notifications for time bucket: ${currentBucket}`);

    try {
      // Get users in current time bucket using DAO
      const bucketUsers = await this.timeBucketDAO.getAll(currentBucket);

      if (bucketUsers.length === 0) {
        logger.info(`No users found in bucket ${currentBucket}`);
        return [];
      }

      logger.info(`Found ${bucketUsers.length} users in bucket ${currentBucket}`);

      // Filter eligible user IDs using denormalized last_update_at field
      const cutoffTime = Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
      const eligibleUserIds: string[] = [];

      for (const bucketUser of bucketUsers) {
        try {
          // Check recent activity using denormalized last_update_at field
          if (bucketUser.last_update_at.seconds > cutoffTime.seconds) {
            logger.info(
              `Skipping user ${bucketUser.user_id} due to recent update (${bucketUser.last_update_at.toDate()})`,
            );
            continue;
          }

          eligibleUserIds.push(bucketUser.user_id);
        } catch (error) {
          logger.error(`Failed to process user ${bucketUser.user_id} in bucket ${currentBucket}`, error);
        }
      }

      if (eligibleUserIds.length === 0) {
        logger.info(`No eligible users found in bucket ${currentBucket} after activity filtering`);
        return [];
      }

      logger.info(`Found ${eligibleUserIds.length} eligible user IDs, fetching profiles in batch`);

      // Batch fetch all eligible profiles in a single query
      const profiles = await this.profileDAO.getAll(eligibleUserIds);

      // ProfileDAO.getAll() filters out non-existent profiles, so we can use them directly
      const eligibleUsers = profiles;

      // Log any missing profiles for debugging
      if (profiles.length < eligibleUserIds.length) {
        const foundUserIds = new Set(profiles.map((p) => p.user_id));
        const missingUserIds = eligibleUserIds.filter((id) => !foundUserIds.has(id));
        logger.warn(`Missing profiles for users: ${missingUserIds.join(', ')} in bucket ${currentBucket}`);
      }

      logger.info(`Found ${eligibleUsers.length} eligible users in bucket ${currentBucket}`);
      return eligibleUsers;
    } catch (error) {
      logger.error(`Failed to process time bucket ${currentBucket}`, error);
      return [];
    }
  }

  /**
   * Updates the last_update_at timestamp for a user across all their time buckets
   * Called when a user creates an update to track their posting activity
   * @param userId The user who created an update
   * @param updateTime The timestamp of the update creation
   */
  async updateUserLastUpdateTime(userId: string, updateTime: Timestamp): Promise<void> {
    logger.info(`Updating last update time for user ${userId}`);

    try {
      await this.timeBucketDAO.updateUserLastUpdateTime(userId, updateTime);
      logger.info(`Successfully updated last update time for user ${userId}`);
    } catch (error) {
      logger.error(`Failed to update last update time for user ${userId}`, error);
      throw error;
    }
  }
}
