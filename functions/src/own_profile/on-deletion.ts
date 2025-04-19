import {getFirestore, QueryDocumentSnapshot} from "firebase-admin/firestore";
import {FirestoreEvent} from "firebase-functions/v2/firestore";
import {DeleteProfileEventParams, EventName} from "../models/analytics-events";
import {
  Collections,
  FeedFields,
  FriendshipFields,
  GroupFields,
  InvitationFields,
  MAX_BATCH_OPERATIONS,
  QueryOperators,
  UpdateFields,
  UserSummaryFields
} from "../models/constants";
import {trackApiEvent} from "../utils/analytics-utils";
import {getLogger} from "../utils/logging-utils";

const logger = getLogger(__filename);

/**
 * Helper function to stream and process a collection with batched writes.
 *
 * @param query - Firestore query to stream
 * @param processDocument - Function to process each document
 * @param db - Firestore instance
 * @param operationName - Name of the operation for logging
 * @param finalOperation - Optional function to run after all documents are processed
 * @param useBatch - Whether to use batch processing (default: true)
 * @returns Total number of documents processed
 */
const streamAndProcessCollection = async (
  query: FirebaseFirestore.Query,
  processDocument: (
    doc: QueryDocumentSnapshot,
    batch: FirebaseFirestore.WriteBatch,
    db: FirebaseFirestore.Firestore
  ) => void | Promise<void>,
  db: FirebaseFirestore.Firestore,
  operationName: string,
  finalOperation?: () => Promise<void>,
  useBatch: boolean = true
): Promise<number> => {
  let batch = db.batch();
  let batchCount = 0;
  let totalProcessed = 0;

  try {
    // Stream the documents using for-await loop (same pattern as in update-my-profile.ts)
    for await (const doc of query.stream()) {
      const docSnapshot = doc as unknown as QueryDocumentSnapshot;

      try {
        if (useBatch) {
          await processDocument(docSnapshot, batch, db);
          batchCount++;
          totalProcessed++;

          // Commit the batch if it reaches the maximum size
          if (batchCount >= MAX_BATCH_OPERATIONS) {
            await batch.commit();
            logger.info(`Committed batch with ${batchCount} ${operationName}`);
            batchCount = 0;
            // Create a new batch
            batch = db.batch();
          }
        } else {
          // Process without batching
          await processDocument(docSnapshot, batch, db);
          totalProcessed++;
        }
      } catch (error) {
        logger.error(`Error processing document: ${error}`);
        throw error;
      }
    }

    // Commit any remaining documents if using batch
    if (useBatch && batchCount > 0) {
      await batch.commit();
      logger.info(`Committed batch with ${batchCount} ${operationName}`);
    }

    // Run final operation if provided
    if (finalOperation) {
      await finalOperation();
    }

    logger.info(`Processed ${totalProcessed} ${operationName}`);
  } catch (error) {
    logger.error(`Error streaming ${operationName}: ${error}`);
    throw error;
  }

  return totalProcessed;
};


/**
 * Delete all friendships involving the user.
 *
 * @param db - Firestore client
 * @param userId - The ID of the user whose profile was deleted
 * @returns The number of friendships deleted
 */
const deleteFriendships = async (
  db: FirebaseFirestore.Firestore,
  userId: string
): Promise<number> => {
  logger.info(`Deleting friendships for user ${userId}`);

  // Get all friendships involving the user
  const friendshipsQuery = db.collection(Collections.FRIENDSHIPS)
    .where(FriendshipFields.MEMBERS, QueryOperators.ARRAY_CONTAINS, userId);

  // Process each friendship document
  const processFriendshipDoc = (friendshipDoc: QueryDocumentSnapshot, batch: FirebaseFirestore.WriteBatch) => {
    batch.delete(friendshipDoc.ref);
  };

  // Stream and process the friendships
  const totalDeleted = await streamAndProcessCollection(
    friendshipsQuery,
    processFriendshipDoc,
    db,
    "friendship deletions"
  );

  logger.info(`Deleted ${totalDeleted} friendships for user ${userId}`);
  return totalDeleted;
};

/**
 * Delete all user summaries involving the user.
 *
 * @param db - Firestore client
 * @param userId - The ID of the user whose profile was deleted
 * @returns The number of user summaries deleted
 */
const deleteUserSummaries = async (
  db: FirebaseFirestore.Firestore,
  userId: string
): Promise<number> => {
  logger.info(`Deleting user summaries for user ${userId}`);

  // Get all user summaries where the user is either the creator or the target
  const creatorSummariesQuery = db.collection(Collections.USER_SUMMARIES)
    .where(UserSummaryFields.CREATOR_ID, QueryOperators.EQUALS, userId);

  const targetSummariesQuery = db.collection(Collections.USER_SUMMARIES)
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
    "user summary deletions (creator)"
  );

  // Stream and process the target summaries
  const targetDeleted = await streamAndProcessCollection(
    targetSummariesQuery,
    processSummaryDoc,
    db,
    "user summary deletions (target)"
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
const exitGroups = async (
  db: FirebaseFirestore.Firestore,
  userId: string
): Promise<number> => {
  logger.info(`Removing user ${userId} from groups`);

  // Get all groups the user is a member of
  const groupsQuery = db.collection(Collections.GROUPS)
    .where(GroupFields.MEMBERS, QueryOperators.ARRAY_CONTAINS, userId);

  // Process each group document
  const processGroupDoc = (groupDoc: QueryDocumentSnapshot, batch: FirebaseFirestore.WriteBatch) => {
    const groupData = groupDoc.data();
    const members = groupData[GroupFields.MEMBERS] || [];
    const memberProfiles = groupData[GroupFields.MEMBER_PROFILES] || [];

    // Remove the user from the members array
    const updatedMembers = members.filter((memberId: string) => memberId !== userId);

    // Remove the user's profile from the member_profiles array
    const updatedMemberProfiles = memberProfiles.filter((profile: any) => {
      return profile.user_id !== userId;
    });

    // Update the group document
    batch.update(groupDoc.ref, {
      [GroupFields.MEMBERS]: updatedMembers,
      [GroupFields.MEMBER_PROFILES]: updatedMemberProfiles
    });
  };

  // Stream and process the groups
  const totalUpdated = await streamAndProcessCollection(
    groupsQuery,
    processGroupDoc,
    db,
    "group updates"
  );

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
const deleteDeviceInfo = async (
  db: FirebaseFirestore.Firestore,
  userId: string
): Promise<number> => {
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
 * feed items from all users (including the user's own feed), and then deletes the update itself.
 *
 * @param db - Firestore client
 * @param userId - The ID of the user whose profile was deleted
 * @returns An object containing the number of updates and feed entries deleted
 */
const deleteUpdateAndFeedData = async (
  db: FirebaseFirestore.Firestore,
  userId: string
): Promise<{ updateCount: number; feedCount: number }> => {
  logger.info(`Deleting all feed data and updates for user ${userId}`);

  // 1. First, get all update IDs created by the user
  const updatesQuery = db.collection(Collections.UPDATES)
    .where(UpdateFields.CREATED_BY, QueryOperators.EQUALS, userId)
    .select();

  const updateIds: string[] = [];
  for await (const doc of updatesQuery.stream()) {
    const updateDoc = doc as unknown as QueryDocumentSnapshot;
    updateIds.push(updateDoc.id);
  }

  if (updateIds.length === 0) {
    logger.info(`No updates found for user ${userId}`);
    return {updateCount: 0, feedCount: 0};
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
    const feedEntriesQuery = db.collectionGroup(Collections.FEED)
      .where(FeedFields.UPDATE_ID, QueryOperators.IN, chunk);

    // Process feed entries
    for await (const doc of feedEntriesQuery.stream()) {
      const feedEntryDoc = doc as unknown as QueryDocumentSnapshot;
      batch.delete(feedEntryDoc.ref);
      totalFeedEntriesDeleted++;
      batchCount++;

      // Commit batch if it reaches the maximum size
      if (batchCount >= MAX_BATCH_OPERATIONS) {
        await batch.commit();
        logger.info(`Committed batch with ${batchCount} operations`);
        batch = db.batch();
        batchCount = 0;
      }
    }

    // Add update deletions to the same batch
    for (const updateId of chunk) {
      batch.delete(db.collection(Collections.UPDATES).doc(updateId));
      totalUpdatesDeleted++;
      batchCount++;

      // Commit batch if it reaches the maximum size
      if (batchCount >= MAX_BATCH_OPERATIONS) {
        await batch.commit();
        logger.info(`Committed batch with ${batchCount} operations`);
        batch = db.batch();
        batchCount = 0;
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
  return {updateCount: totalUpdatesDeleted, feedCount: totalFeedEntriesDeleted};
};

/**
 * Delete all invitations sent by or received by the user.
 *
 * @param db - Firestore client
 * @param userId - The ID of the user whose profile was deleted
 * @returns The number of invitations deleted
 */
const deleteInvitations = async (
  db: FirebaseFirestore.Firestore,
  userId: string
): Promise<number> => {
  logger.info(`Deleting invitations for user ${userId}`);

  // Get all invitations sent by the user
  const sentInvitationsQuery = db.collection(Collections.INVITATIONS)
    .where(InvitationFields.SENDER_ID, QueryOperators.EQUALS, userId);

  // Process each invitation document
  const processInvitationDoc = (invitationDoc: QueryDocumentSnapshot, batch: FirebaseFirestore.WriteBatch) => {
    batch.delete(invitationDoc.ref);
  };

  // Stream and process the sent invitations
  const totalSentDeleted = await streamAndProcessCollection(
    sentInvitationsQuery,
    processInvitationDoc,
    db,
    "sent invitation deletions"
  );

  logger.info(`Deleted ${totalSentDeleted} invitations sent by user ${userId}`);
  return totalSentDeleted;
};

/**
 * Delete all data related to the user.
 *
 * @param db - Firestore client
 * @param userId - The ID of the user whose profile was deleted
 */
const deleteAllUserData = async (
  db: FirebaseFirestore.Firestore,
  userId: string
): Promise<void> => {
  logger.info(`Starting deletion of all data for user ${userId}`);

  // Run all deletion tasks in parallel
  const [updateData, friendCount, summaryCount, groupCount, deviceCount, invitationCount] = await Promise.all([
    deleteUpdateAndFeedData(db, userId),
    deleteFriendships(db, userId),
    deleteUserSummaries(db, userId),
    exitGroups(db, userId),
    deleteDeviceInfo(db, userId),
    deleteInvitations(db, userId)
  ]);

  // Track analytics event
  const analytics: DeleteProfileEventParams = {
    update_count: updateData.updateCount,
    feed_count: updateData.feedCount,
    friend_count: friendCount,
    summary_count: summaryCount,
    group_count: groupCount,
    device_count: deviceCount,
    invitation_count: invitationCount
  };

  trackApiEvent(
    EventName.PROFILE_DELETED,
    userId,
    analytics
  );

  logger.info(`Tracked delete profile analytics: ${JSON.stringify(analytics)}`);

  logger.info(`Completed deletion of all data for user ${userId}`);
};

/**
 * Firestore trigger function that runs when a profile is deleted.
 *
 * @param event - The Firestore event object containing the document data
 */
export const onProfileDeleted = async (event: FirestoreEvent<QueryDocumentSnapshot | undefined, {
  id: string
}>): Promise<void> => {
  if (!event.data) {
    logger.error("No data in profile deletion event");
    return;
  }

  const userId = event.params.id;
  logger.info(`Processing profile deletion for user: ${userId}`);

  // Initialize Firestore client
  const db = getFirestore();

  try {
    await deleteAllUserData(db, userId);
    logger.info(`Successfully processed profile deletion for user ${userId}`);
  } catch (error) {
    logger.error(`Error processing profile deletion for user ${userId}: ${error}`);
    // In a production environment, we would implement retry logic here
  }
};
