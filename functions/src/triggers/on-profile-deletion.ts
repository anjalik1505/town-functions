import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { FirestoreEvent } from 'firebase-functions/v2/firestore';
import { DeleteProfileEventParams, EventName } from '../models/analytics-events.js';
import {
  Collections,
  FeedFields,
  FriendshipFields,
  GroupFields,
  MAX_BATCH_OPERATIONS,
  ProfileFields,
  QueryOperators,
  UpdateFields,
  UserSummaryFields,
} from '../models/constants.js';
import { trackApiEvent } from '../utils/analytics-utils.js';
import { streamAndProcessCollection } from '../utils/deletion-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { calculateTimeBucket } from '../utils/timezone-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';
import { GroupMember } from '../models/data-models.js';
import { deleteInvitation } from '../utils/invitation-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Delete all friendships involving the user and clean up friend subcollections.
 *
 * @param db - Firestore client
 * @param userId - The ID of the user whose profile was deleted
 * @param profileData - The deleted profile document data
 * @returns The number of friendships deleted
 */
const deleteFriendships = async (
  db: FirebaseFirestore.Firestore,
  userId: string,
  profileData: FirebaseFirestore.DocumentData,
): Promise<number> => {
  logger.info(`Deleting friendship data for user ${userId}`);

  // Get friends list from the deleted profile document
  const friendIds: string[] = profileData[ProfileFields.FRIENDS_TO_CLEANUP] || [];

  if (friendIds.length === 0) {
    logger.info(`No friends found in cleanup data for user ${userId}`);
    return 0;
  }

  logger.info(`Found ${friendIds.length} friends to clean up for user ${userId}`);

  let batch = db.batch();
  let batchCount = 0;
  let totalDeleted = 0;

  // Remove this user from each friend's subcollection
  for (const friendId of friendIds) {
    const friendDocRef = db.collection(Collections.PROFILES).doc(friendId).collection(Collections.FRIENDS).doc(userId);

    batch.delete(friendDocRef);
    batchCount++;
    totalDeleted++;

    // Commit batch if it reaches the maximum size
    if (batchCount >= MAX_BATCH_OPERATIONS) {
      await batch.commit();
      logger.info(`Committed batch with ${batchCount} friend deletions`);
      batch = db.batch();
      batchCount = 0;
    }
  }

  // Delete old FRIENDSHIPS collection documents
  const friendshipsQuery = db
    .collection(Collections.FRIENDSHIPS)
    .where(FriendshipFields.MEMBERS, QueryOperators.ARRAY_CONTAINS, userId);

  // Process each friendship document
  const processFriendshipDoc = (friendshipDoc: QueryDocumentSnapshot, currentBatch: FirebaseFirestore.WriteBatch) => {
    currentBatch.delete(friendshipDoc.ref);
  };

  // Stream and process the friendships
  const oldFriendshipsDeleted = await streamAndProcessCollection(
    friendshipsQuery,
    processFriendshipDoc,
    db,
    'friendship deletions',
  );

  // Commit any remaining friend deletions
  if (batchCount > 0) {
    await batch.commit();
    logger.info(`Committed final batch with ${batchCount} friend deletions`);
  }

  const totalFriendships = totalDeleted + oldFriendshipsDeleted;
  logger.info(
    `Deleted ${totalDeleted} friend docs and ${oldFriendshipsDeleted} old friendship docs for user ${userId}`,
  );
  return totalFriendships;
};

/**
 * Delete all user summaries involving the user.
 *
 * @param db - Firestore client
 * @param userId - The ID of the user whose profile was deleted
 * @returns The number of user summaries deleted
 */
const deleteUserSummaries = async (db: FirebaseFirestore.Firestore, userId: string): Promise<number> => {
  logger.info(`Deleting user summaries for user ${userId}`);

  // Get all user summaries where the user is either the creator or the target
  const creatorSummariesQuery = db
    .collection(Collections.USER_SUMMARIES)
    .where(UserSummaryFields.CREATOR_ID, QueryOperators.EQUALS, userId);

  const targetSummariesQuery = db
    .collection(Collections.USER_SUMMARIES)
    .where(UserSummaryFields.TARGET_ID, QueryOperators.EQUALS, userId);

  // Process each summary document
  const processSummaryDoc = (summaryDoc: QueryDocumentSnapshot, batch: FirebaseFirestore.WriteBatch) => {
    batch.delete(summaryDoc.ref);
  };

  // Stream and process the creator summaries
  const creatorDeleted = await streamAndProcessCollection(
    creatorSummariesQuery,
    processSummaryDoc,
    db,
    'user summary deletions (creator)',
  );

  // Stream and process the target summaries
  const targetDeleted = await streamAndProcessCollection(
    targetSummariesQuery,
    processSummaryDoc,
    db,
    'user summary deletions (target)',
  );

  const totalDeleted = creatorDeleted + targetDeleted;
  logger.info(`Deleted ${totalDeleted} user summaries for user ${userId}`);
  return totalDeleted;
};

/**
 * Remove the user from all groups they are a member of.
 *
 * @param db - Firestore client
 * @param userId - The ID of the user whose profile was deleted
 * @returns The number of groups the user was removed from
 */
const exitGroups = async (db: FirebaseFirestore.Firestore, userId: string): Promise<number> => {
  logger.info(`Removing user ${userId} from groups`);

  // Get all groups the user is a member of
  const groupsQuery = db
    .collection(Collections.GROUPS)
    .where(GroupFields.MEMBERS, QueryOperators.ARRAY_CONTAINS, userId);

  // Process each group document
  const processGroupDoc = (groupDoc: QueryDocumentSnapshot, batch: FirebaseFirestore.WriteBatch) => {
    const groupData = groupDoc.data();
    const members = groupData[GroupFields.MEMBERS] || [];
    const memberProfiles = groupData[GroupFields.MEMBER_PROFILES] || [];

    // Remove the user from the member array
    const updatedMembers = members.filter((memberId: string) => memberId !== userId);

    // Remove the user's profile from the member_profiles array
    const updatedMemberProfiles = memberProfiles.filter((profile: GroupMember) => {
      return profile.user_id !== userId;
    });

    // Update the group document
    batch.update(groupDoc.ref, {
      [GroupFields.MEMBERS]: updatedMembers,
      [GroupFields.MEMBER_PROFILES]: updatedMemberProfiles,
    });
  };

  // Stream and process the groups
  const totalUpdated = await streamAndProcessCollection(groupsQuery, processGroupDoc, db, 'group updates');

  logger.info(`Removed user ${userId} from ${totalUpdated} groups`);
  return totalUpdated;
};

/**
 * Delete the user's device information.
 *
 * @param db - Firestore client
 * @param userId - The ID of the user whose profile was deleted
 * @returns The number of device records deleted (0 or 1)
 */
const deleteDeviceInfo = async (db: FirebaseFirestore.Firestore, userId: string): Promise<number> => {
  logger.info(`Deleting device information for user ${userId}`);

  // Get the device document
  const deviceRef = db.collection(Collections.DEVICES).doc(userId);
  const deviceDoc = await deviceRef.get();

  if (!deviceDoc.exists) {
    logger.info(`No device information found for user ${userId}`);
    return 0;
  }

  // Delete the device document
  await deviceRef.delete();

  logger.info(`Deleted device information for user ${userId}`);
  return 1;
};

/**
 * Delete all feed data and updates for a user.
 * This function streams updates created by the user, for each update collects and deletes
 * feed items from all users (including the user's own feed) and then deletes the update itself.
 *
 * @param db - Firestore client
 * @param userId - The ID of the user whose profile was deleted
 * @returns An object containing the number of updates and feed entries deleted
 */
const deleteUpdateAndFeedData = async (
  db: FirebaseFirestore.Firestore,
  userId: string,
): Promise<{ updateCount: number; feedCount: number }> => {
  logger.info(`Deleting all feed data and updates for user ${userId}`);

  // 1. First, get all update IDs created by the user
  const updatesQuery = db
    .collection(Collections.UPDATES)
    .where(UpdateFields.CREATED_BY, QueryOperators.EQUALS, userId)
    .select();

  const updateIds: string[] = [];
  for await (const doc of updatesQuery.stream()) {
    const updateDoc = doc as unknown as QueryDocumentSnapshot;
    updateIds.push(updateDoc.id);
  }

  if (updateIds.length === 0) {
    logger.info(`No updates found for user ${userId}`);
    return { updateCount: 0, feedCount: 0 };
  }

  // 2. Create a single batch for all operations
  let batch = db.batch();
  let batchCount = 0;
  let totalFeedEntriesDeleted = 0;
  let totalUpdatesDeleted = 0;

  // 3. Process updates in chunks to avoid query size limits
  const CHUNK_SIZE = 10;
  for (let i = 0; i < updateIds.length; i += CHUNK_SIZE) {
    const chunk = updateIds.slice(i, i + CHUNK_SIZE);

    // 4. Query all feed entries that reference any of these updates
    const feedEntriesQuery = db.collectionGroup(Collections.FEED).where(FeedFields.UPDATE_ID, QueryOperators.IN, chunk);

    // Process feed entries
    for await (const doc of feedEntriesQuery.stream()) {
      const feedEntryDoc = doc as unknown as QueryDocumentSnapshot;
      batch.delete(feedEntryDoc.ref);
      totalFeedEntriesDeleted++;
      batchCount++;

      // Commit a batch if it reaches the maximum size
      if (batchCount >= MAX_BATCH_OPERATIONS) {
        await batch.commit();
        logger.info(`Committed batch with ${batchCount} operations`);
        batch = db.batch();
        batchCount = 0;
      }
    }

    // Process each update - use recursiveDelete to delete document and all subcollections
    for (const updateId of chunk) {
      try {
        const updateRef = db.collection(Collections.UPDATES).doc(updateId);

        // Use recursiveDelete to delete the document and all its subcollections
        await db.recursiveDelete(updateRef);
        totalUpdatesDeleted++;

        logger.info(`Recursively deleted update ${updateId} and all its subcollections`);
      } catch (error) {
        logger.error(`Error deleting update ${updateId}: ${error}`);
        // Continue with other updates
      }
    }
  }

  // 5. Commit any remaining operations
  if (batchCount > 0) {
    await batch.commit();
    logger.info(`Committed final batch with ${batchCount} operations`);
  }

  // 6. Delete the user's feed document
  const userFeedRef = db.collection(Collections.USER_FEEDS).doc(userId);
  const userFeedDoc = await userFeedRef.get();

  if (userFeedDoc.exists) {
    await userFeedRef.delete();
    logger.info(`Deleted user feed document for user ${userId}`);
  }

  logger.info(`Deleted ${totalFeedEntriesDeleted} feed entries and ${totalUpdatesDeleted} updates for user ${userId}`);
  return {
    updateCount: totalUpdatesDeleted,
    feedCount: totalFeedEntriesDeleted,
  };
};

/**
 * Delete the user from time buckets collection.
 *
 * @param db - Firestore client
 * @param userId - The ID of the user whose profile was deleted
 * @param profileData - The profile data of the deleted user
 * @returns Whether the time bucket was successfully cleaned up
 */
const deleteTimeBucket = async (
  db: FirebaseFirestore.Firestore,
  userId: string,
  profileData: FirebaseFirestore.DocumentData,
): Promise<boolean> => {
  logger.info(`Removing user ${userId} from time buckets`);

  try {
    const timezone = profileData[ProfileFields.TIMEZONE];
    if (!timezone) {
      logger.info(`User ${userId} has no timezone set, skipping time bucket cleanup`);
      return true;
    }

    // Calculate the time bucket for the user's timezone
    const timeBucket = calculateTimeBucket(timezone);

    // Remove user from the time bucket
    const userBucketRef = db
      .collection(Collections.TIME_BUCKETS)
      .doc(timeBucket.toString())
      .collection(Collections.TIME_BUCKET_USERS)
      .doc(userId);

    await userBucketRef.delete();
    logger.info(`Removed user ${userId} from time bucket ${timeBucket}`);
    return true;
  } catch (error) {
    logger.error(`Error removing user ${userId} from time buckets: ${error}`);
    return false;
  }
};

/**
 * Delete the user's avatar from storage if it exists.
 *
 * @param userId - The ID of the user whose profile was deleted
 * @param profileData - The profile data of the deleted user
 * @returns Whether the avatar was successfully deleted
 */
const deleteAvatar = async (userId: string, profileData: FirebaseFirestore.DocumentData): Promise<boolean> => {
  logger.info(`Checking for avatar to delete for user ${userId}`);

  const avatarUrl = profileData[ProfileFields.AVATAR];
  if (!avatarUrl) {
    logger.info(`User ${userId} has no avatar, skipping avatar deletion`);
    return true;
  }

  try {
    // Skip deletion for Google account avatars
    if (avatarUrl.includes('googleusercontent.com')) {
      logger.info(`Avatar for user ${userId} is from Google account, skipping deletion`);
      return true;
    }

    // Only handle Firebase Storage URLs
    if (!avatarUrl.includes('firebasestorage.googleapis.com') && !avatarUrl.startsWith('gs://')) {
      logger.info(`Avatar URL for user ${userId} is not from Firebase Storage, skipping deletion`);
      return true;
    }

    const storage = getStorage();

    try {
      // Delete the file using the URL directly
      if (avatarUrl.startsWith('gs://')) {
        // For gs:// URLs, parse the bucket and path
        const gsPath = avatarUrl.substring(5); // Remove 'gs://'
        const slashIndex = gsPath.indexOf('/');
        if (slashIndex === -1) {
          throw new Error(`Invalid gs:// URL format: ${avatarUrl}`);
        }

        const bucketName = gsPath.substring(0, slashIndex);
        const filePath = gsPath.substring(slashIndex + 1);

        await storage.bucket(bucketName).file(filePath).delete();
      } else {
        // For HTTP URLs, we need to extract the path
        // Example: https://firebasestorage.googleapis.com/v0/b/BUCKET/o/PATH?alt=media&token=TOKEN
        const match = avatarUrl.match(/firebasestorage\.googleapis\.com\/v0\/b\/([^\/]+)\/o\/([^?]+)/);
        if (!match || match.length < 3) {
          throw new Error(`Could not parse Firebase Storage URL: ${avatarUrl}`);
        }

        const bucketName = match[1];
        const filePath = decodeURIComponent(match[2]);

        await storage.bucket(bucketName).file(filePath).delete();
      }

      logger.info(`Deleted avatar for user ${userId}`);
      return true;
    } catch (storageError) {
      logger.error(`Error deleting avatar file for user ${userId}: ${storageError}`);
      // Continue with profile deletion even if avatar deletion fails
      return false;
    }
  } catch (error) {
    logger.error(`Error deleting avatar for user ${userId}: ${error}`);
    return false;
  }
};

/**
 * Delete all data related to the user with retry mechanism.
 *
 * @param db - Firestore client
 * @param userId - The ID of the user whose profile was deleted
 * @param profileData - The profile data of the deleted user
 */
const deleteAllUserData = async (
  db: FirebaseFirestore.Firestore,
  userId: string,
  profileData: FirebaseFirestore.DocumentData,
): Promise<void> => {
  logger.info(`Starting deletion of all data for user ${userId}`);

  // Define maximum retry attempts and delay between retries
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 1000;

  // Create a function to retry operations with exponential backoff
  const retryOperation = async <T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = MAX_RETRIES,
  ): Promise<T> => {
    let lastError: Error | unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        logger.warn(`Attempt ${attempt}/${maxRetries} for ${operationName} failed: ${error}`);

        if (attempt < maxRetries) {
          // Exponential backoff with jitter
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1) * (0.5 + Math.random() * 0.5);
          logger.info(`Retrying ${operationName} in ${Math.round(delay)}ms...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw new Error(`All ${maxRetries} attempts for ${operationName} failed. Last error: ${lastError}`);
  };

  // Track success/failure of each operation
  const results = {
    updateAndFeed: false,
    friendships: false,
    userSummaries: false,
    groups: false,
    deviceInfo: false,
    invitations: false,
    timeBucket: false,
    avatar: false,
  };

  // Run all deletion tasks with retries
  try {
    // First, try to delete the avatar and time bucket as they're independent
    results.timeBucket = await retryOperation(() => deleteTimeBucket(db, userId, profileData), 'time bucket deletion');

    results.avatar = await retryOperation(() => deleteAvatar(userId, profileData), 'avatar deletion');

    // Then run the main data deletion operations in parallel
    const [updateData, friendCount, summaryCount, groupCount, deviceCount, invitationCount] = await Promise.all([
      retryOperation(() => deleteUpdateAndFeedData(db, userId), 'update and feed deletion')
        .then((result) => {
          results.updateAndFeed = true;
          return result;
        })
        .catch((err) => {
          logger.error(`Failed to delete updates: ${err}`);
          return { updateCount: 0, feedCount: 0 };
        }),
      retryOperation(() => deleteFriendships(db, userId, profileData), 'friendship deletion')
        .then((result) => {
          results.friendships = true;
          return result;
        })
        .catch((err) => {
          logger.error(`Failed to delete friendships: ${err}`);
          return 0;
        }),
      retryOperation(() => deleteUserSummaries(db, userId), 'user summary deletion')
        .then((result) => {
          results.userSummaries = true;
          return result;
        })
        .catch((err) => {
          logger.error(`Failed to delete user summaries: ${err}`);
          return 0;
        }),
      retryOperation(() => exitGroups(db, userId), 'group exit')
        .then((result) => {
          results.groups = true;
          return result;
        })
        .catch((err) => {
          logger.error(`Failed to exit groups: ${err}`);
          return 0;
        }),
      retryOperation(() => deleteDeviceInfo(db, userId), 'device info deletion')
        .then((result) => {
          results.deviceInfo = true;
          return result;
        })
        .catch((err) => {
          logger.error(`Failed to delete device info: ${err}`);
          return 0;
        }),
      retryOperation(() => deleteInvitation(userId), 'invitation deletion')
        .then((result) => {
          results.invitations = true;
          return result;
        })
        .catch((err) => {
          logger.error(`Failed to delete invitations: ${err}`);
          return 0;
        }),
    ]);

    // Track analytics event
    const analytics: DeleteProfileEventParams = {
      update_count: updateData.updateCount,
      feed_count: updateData.feedCount,
      friend_count: friendCount,
      summary_count: summaryCount,
      group_count: groupCount,
      device_count: deviceCount,
      invitation_count: invitationCount,
    };

    // Log the results of all operations
    logger.info(`User data deletion results: ${JSON.stringify(results)}`);

    trackApiEvent(EventName.PROFILE_DELETED, userId, analytics);
    logger.info(`Tracked delete profile analytics: ${JSON.stringify(analytics)}`);
  } catch (error) {
    logger.error(`Error during user data deletion for ${userId}: ${error}`);
    logger.error(`Deletion results: ${JSON.stringify(results)}`);

    // Throw the error to be caught by the caller
    throw error;
  }

  logger.info(`Completed deletion of all data for user ${userId}`);
};

/**
 * Firestore trigger function that runs when a profile is deleted.
 *
 * @param event - The Firestore event object containing the document data
 */
export const onProfileDeleted = async (
  event: FirestoreEvent<
    QueryDocumentSnapshot | undefined,
    {
      id: string;
    }
  >,
): Promise<void> => {
  if (!event.data) {
    logger.error('No data in profile deletion event');
    return;
  }

  const userId = event.params.id;
  const profileData = event.data.data() || {};
  logger.info(`Processing profile deletion for user: ${userId}`);

  // Initialize Firestore client
  const db = getFirestore();

  // Define maximum retry attempts for the entire operation
  const MAX_OVERALL_RETRIES = 3;
  let attempt = 0;
  let success = false;

  while (attempt < MAX_OVERALL_RETRIES && !success) {
    attempt++;
    try {
      await deleteAllUserData(db, userId, profileData);
      success = true;
      logger.info(`Successfully processed profile deletion for user ${userId} on attempt ${attempt}`);
    } catch (error) {
      logger.error(`Error processing profile deletion for user ${userId} on attempt ${attempt}: ${error}`);

      if (attempt < MAX_OVERALL_RETRIES) {
        // Wait before retrying with exponential backoff
        const delay = 2000 * Math.pow(2, attempt - 1);
        logger.info(`Will retry entire profile deletion in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        logger.error(
          `Failed to delete user data after ${MAX_OVERALL_RETRIES} attempts. Manual cleanup may be required.`,
        );
        // In a production environment, we would implement a dead-letter queue or alert system here
      }
    }
  }
};
