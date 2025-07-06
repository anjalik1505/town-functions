import { getFirestore } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DeviceDAO,
  FeedDAO,
  FriendshipDAO,
  GroupDAO,
  InvitationDAO,
  JoinRequestDAO,
  StorageDAO,
  TimeBucketDAO,
  UpdateDAO,
  UserSummaryDAO,
} from '../dao/index.js';
import { commitBatch, commitFinal } from '../utils/batch-utils.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * User cleanup service that provides the 8 specific cleanup operations
 * called by the on-profile-deletion.ts trigger.
 *
 * This service is designed to be compatible with the trigger's expectations
 * and only includes the operations that are actually called.
 */
export class UserCleanupService {
  // Required DAOs for the 8 cleanup operations
  private friendshipDAO: FriendshipDAO;
  private groupDAO: GroupDAO;
  private updateDAO: UpdateDAO;
  private feedDAO: FeedDAO;
  private invitationDAO: InvitationDAO;
  private joinRequestDAO: JoinRequestDAO;
  private deviceDAO: DeviceDAO;
  private userSummaryDAO: UserSummaryDAO;
  private timeBucketDAO: TimeBucketDAO;
  private storageDAO: StorageDAO;

  // Database connection
  private db: FirebaseFirestore.Firestore;

  constructor() {
    // Initialize only the required DAOs
    this.friendshipDAO = new FriendshipDAO();
    this.groupDAO = new GroupDAO();
    this.updateDAO = new UpdateDAO();
    this.feedDAO = new FeedDAO();
    this.invitationDAO = new InvitationDAO();
    this.joinRequestDAO = new JoinRequestDAO();
    this.deviceDAO = new DeviceDAO();
    this.userSummaryDAO = new UserSummaryDAO();
    this.timeBucketDAO = new TimeBucketDAO();
    this.storageDAO = new StorageDAO();
    this.db = getFirestore();
  }

  /**
   * Removes user from all friendships.
   * Called by on-profile-deletion.ts trigger.
   *
   * @param userId The user ID to remove from friend subcollections
   * @param friendIds Array of friend IDs to remove the user from
   * @returns Number of friendships cleaned up
   */
  async removeUserFromAllFriendships(userId: string, friendIds: string[]): Promise<number> {
    logger.info(`Removing user ${userId} from ${friendIds.length} friend subcollections`);

    if (friendIds.length === 0) {
      logger.info(`No friendships to clean up for user ${userId}`);
      return 0;
    }

    let totalCleanups = 0;
    let batch = this.db.batch();
    let batchCount = 0;

    try {
      // Remove user from each friend's FRIENDS subcollection
      for (const friendId of friendIds) {
        // Use the FriendshipDAO delete method to remove bidirectional friendship
        this.friendshipDAO.delete(friendId, userId, batch);
        batchCount++;
        totalCleanups++;

        // Commit batch if approaching limit
        const result = await commitBatch(this.db, batch, batchCount);
        batch = result.batch;
        batchCount = result.batchCount;
      }

      // Commit any remaining operations
      await commitFinal(batch, batchCount);

      logger.info(`Successfully cleaned up ${totalCleanups} friendships for user ${userId}`);
      return totalCleanups;
    } catch (error) {
      logger.error(`Error removing user ${userId} from friendships:`, error);
      throw error;
    }
  }

  /**
   * Removes a user from all groups they are a member of.
   * Called by on-profile-deletion.ts trigger.
   *
   * @param userId The user ID to remove from all groups
   * @returns Number of groups the user was removed from
   */
  async removeUserFromAllGroups(userId: string): Promise<number> {
    logger.info(`Removing user ${userId} from all groups`);

    let totalUpdates = 0;

    try {
      // Get all groups where the user is a member
      const userGroups = await this.groupDAO.getForUser(userId);

      if (userGroups.length === 0) {
        logger.info(`User ${userId} is not a member of any groups`);
        return 0;
      }

      let batch = this.db.batch();
      let batchCount = 0;

      for (const group of userGroups) {
        await this.groupDAO.removeMember(group.group_id, userId, batch);

        const result = await commitBatch(this.db, batch, batchCount);
        batch = result.batch;
        batchCount = result.batchCount;

        totalUpdates++;
      }

      await commitFinal(batch, batchCount);

      logger.info(`Removed user ${userId} from ${totalUpdates} groups`);
      return totalUpdates;
    } catch (error) {
      logger.error(`Error removing user ${userId} from groups:`, error);
      throw error;
    }
  }

  /**
   * Deletes all updates created by a user and their associated feed entries.
   * Called by on-profile-deletion.ts trigger.
   *
   * @param userId The ID of the user whose updates should be deleted
   * @returns Object containing counts of deleted updates and feed entries, plus update IDs for storage cleanup
   */
  async deleteUserUpdatesAndFeeds(
    userId: string,
  ): Promise<{ updateCount: number; feedCount: number; updateIds: string[] }> {
    logger.info(`Starting deletion of updates and feeds for user: ${userId}`);

    let updateCount = 0;
    let feedCount = 0;
    let batch = this.db.batch();
    let batchCount = 0;

    const updateIds: string[] = [];

    try {
      // First pass: Collect update IDs and delete user's own updates with their subcollections
      for await (const { doc: updateData, ref: updateRef } of this.updateDAO.streamUpdatesByCreator(userId)) {
        updateIds.push(updateData.id);

        // Use recursiveDelete for each update to handle subcollections (comments, reactions)
        await this.db.recursiveDelete(updateRef);
        updateCount++;

        logger.info(`Deleted update ${updateData.id} with all subcollections for user ${userId}`);
      }

      // Second pass: Delete all feed entries for the user (more efficient than per-update deletion)
      await this.feedDAO.delete(userId);
      logger.info(`Deleted user feed document for user ${userId}`);

      // Third pass: Remove user from visible_to arrays in updates where they were shared
      // This handles cases where the user was shared with but didn't create the update
      for await (const { doc: updateData } of this.updateDAO.streamUpdatesSharedWithUser(userId)) {
        this.updateDAO.removeFromVisibleTo(userId, updateData.id, batch);
        batchCount++;

        // Commit batch if it gets too large
        const result = await commitBatch(this.db, batch, batchCount);
        batch = result.batch;
        batchCount = result.batchCount;
      }

      // Fourth pass: Delete feed entries where the user appears as friend_id
      // Use efficient collection group query by friend_id from FeedDAO
      for await (const { ref } of this.feedDAO.streamFeedEntriesByFriendId(userId)) {
        batch.delete(ref);
        batchCount++;
        feedCount++;

        const result = await commitBatch(this.db, batch, batchCount);
        batch = result.batch;
        batchCount = result.batchCount;
      }

      // Commit remaining operations
      await commitFinal(batch, batchCount);

      logger.info(`Successfully deleted ${updateCount} updates and ${feedCount} feed entries for user ${userId}`);

      return { updateCount, feedCount, updateIds };
    } catch (error) {
      logger.error(`Failed to delete updates and feeds for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * Deletes user's invitation document and all associated join requests.
   * Called by on-profile-deletion.ts trigger.
   *
   * @param userId The user ID whose invitations should be deleted
   * @returns Total count of deleted invitations and join requests
   */
  async deleteUserInvitations(userId: string): Promise<number> {
    logger.info(`Deleting user invitations for user ${userId}`);

    let totalDeleted = 0;

    try {
      // Find existing invitation
      const existing = await this.invitationDAO.getByUser(userId);
      let joinRequestsDeleted = 0;

      if (existing) {
        // Paginate through join requests to count how many will be deleted
        let nextCursor: string | null | undefined = undefined;
        do {
          const { requests, nextCursor: cursor } = await this.joinRequestDAO.getByInvitation(existing.id, {
            limit: 500,
            afterCursor: nextCursor ?? undefined,
          });
          joinRequestsDeleted += requests.length;
          nextCursor = cursor;
        } while (nextCursor);

        // Delete the invitation (recursive delete also removes join_requests subcollection)
        await this.invitationDAO.delete(existing.id);

        logger.info(`Deleted invitation ${existing.id} and ${joinRequestsDeleted} associated join request(s)`);
      }

      // Delete all join requests where user is the requester (across all invitations)
      let requesterJoinRequestsDeleted = 0;
      let batch = this.db.batch();
      let batchCount = 0;

      for await (const { requestRef } of this.joinRequestDAO.streamJoinRequestsByRequester(userId)) {
        batch.delete(requestRef);
        batchCount++;
        requesterJoinRequestsDeleted++;

        const result = await commitBatch(this.db, batch, batchCount);
        batch = result.batch;
        batchCount = result.batchCount;
      }

      await commitFinal(batch, batchCount);

      totalDeleted += requesterJoinRequestsDeleted;

      if (requesterJoinRequestsDeleted > 0) {
        logger.info(`Deleted ${requesterJoinRequestsDeleted} join requests where user ${userId} was the requester`);
      }

      logger.info(`Deleted ${totalDeleted} total invitations and join requests for user ${userId}`);
      return totalDeleted;
    } catch (error) {
      logger.error(`Error deleting user invitations for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Deletes the device document for a user if it exists.
   * Called by on-profile-deletion.ts trigger.
   *
   * @param userId The user ID whose device should be deleted
   * @returns Count of devices deleted (0 or 1)
   */
  async deleteDevice(userId: string): Promise<number> {
    logger.info(`Deleting device for user ${userId}`);
    return await this.deviceDAO.delete(userId);
  }

  /**
   * Deletes user summaries where user is creator or target.
   * Called by on-profile-deletion.ts trigger.
   *
   * @param userId The user ID whose summaries to delete
   * @returns Number of summaries deleted
   */
  async deleteUserSummaries(userId: string): Promise<number> {
    logger.info(`Deleting user summaries for user ${userId}`);

    let totalDeleted = 0;
    let batch = this.db.batch();
    let batchCount = 0;

    try {
      // Delete summaries where user is creator
      for await (const { ref } of this.userSummaryDAO.streamSummariesByCreator(userId)) {
        batch.delete(ref);
        batchCount++;
        totalDeleted++;

        const result = await commitBatch(this.db, batch, batchCount);
        batch = result.batch;
        batchCount = result.batchCount;
      }

      // Delete summaries where user is target
      for await (const { ref } of this.userSummaryDAO.streamSummariesByTarget(userId)) {
        batch.delete(ref);
        batchCount++;
        totalDeleted++;

        const result = await commitBatch(this.db, batch, batchCount);
        batch = result.batch;
        batchCount = result.batchCount;
      }

      // Commit remaining operations
      await commitFinal(batch, batchCount);

      logger.info(`Deleted ${totalDeleted} user summaries for user ${userId}`);
      return totalDeleted;
    } catch (error) {
      logger.error(`Failed to delete user summaries for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * Removes user from time buckets.
   * Called by on-profile-deletion.ts trigger.
   *
   * @param userId The user ID to remove from time buckets
   * @returns Boolean indicating success/failure
   */
  async removeFromTimeBuckets(userId: string): Promise<boolean> {
    logger.info(`Removing user ${userId} from time buckets`);

    try {
      await this.timeBucketDAO.remove(userId);
      logger.info(`Removed user ${userId} from time buckets`);
      return true;
    } catch (error) {
      logger.error(`Error removing user ${userId} from time buckets: ${error}`);
      return false;
    }
  }

  /**
   * Deletes user's profile images from Firebase Storage.
   * Called by on-profile-deletion.ts trigger.
   *
   * @param userId The user ID whose profile images should be deleted
   * @returns Boolean indicating success/failure
   */
  async deleteStorageAssets(userId: string): Promise<boolean> {
    logger.info(`Deleting storage assets for user ${userId}`);
    return await this.storageDAO.deleteProfile(userId);
  }

  /**
   * Deletes images for specific updates from Firebase Storage.
   * Called by on-profile-deletion.ts trigger after getting update IDs from deleteUserUpdatesAndFeeds.
   *
   * @param updateIds Array of update IDs whose images should be deleted
   * @returns Boolean indicating success/failure
   */
  async deleteUpdateStorageAssets(updateIds: string[]): Promise<boolean> {
    logger.info(`Deleting update storage assets for ${updateIds.length} updates`);
    return await this.storageDAO.deleteUpdateImages(updateIds);
  }
}
