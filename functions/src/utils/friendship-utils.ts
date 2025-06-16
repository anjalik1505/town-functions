import { getFirestore, QueryDocumentSnapshot, Timestamp, UpdateData } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeImagesFlow } from '../ai/flows.js';
import { EventName, FriendSummaryEventParams } from '../models/analytics-events.js';
import {
  Collections,
  FriendDocFields,
  FriendshipFields,
  MAX_BATCH_OPERATIONS,
  QueryOperators,
  UpdateFields,
} from '../models/constants.js';
import { trackApiEvents } from './analytics-utils.js';
import { processImagesForPrompt } from './image-utils.js';
import { getLogger } from './logging-utils.js';
import { generateFriendSummary, getSummaryContext, SummaryResult, writeFriendSummary } from './summary-utils.js';
import { createFeedItem } from './update-utils.js';
import { createFriendVisibilityIdentifier } from './visibility-utils.js';

const MAX_COMBINED = 20;

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Friendship document result type
 */
type FriendshipDocumentResult = {
  id: string;
  ref: FirebaseFirestore.DocumentReference;
  doc: FirebaseFirestore.DocumentSnapshot;
};

export type FriendDocUpdate = {
  username?: string;
  name?: string;
  avatar?: string;
  last_update_emoji?: string;
  last_update_at?: FirebaseFirestore.Timestamp;
};

/**
 * Retrieves a friendship document reference and document snapshot.
 * @param currentUserId The ID of the current user for the friendship
 * @param targetUserId The ID of the target user for the friendship
 * @returns A promise that resolves with an object containing the friendship document reference and document snapshot.
 *          The document snapshot can be null if the document doesn't exist.
 */
export const getFriendshipRefAndDoc = async (
  currentUserId: string,
  targetUserId: string,
): Promise<FriendshipDocumentResult> => {
  const db = getFirestore();

  const friendshipId = createFriendshipId(currentUserId, targetUserId);

  const friendshipRef = db.collection(Collections.FRIENDSHIPS).doc(friendshipId);
  const friendshipDoc = await friendshipRef.get();

  return {
    id: friendshipId,
    ref: friendshipRef,
    doc: friendshipDoc,
  };
};

/**
 * Creates a consistent friendship ID by sorting user IDs.
 * This ensures that the same friendship ID is generated regardless of which user is first.
 *
 * @param userId1 - First user ID
 * @param userId2 - Second user ID
 * @returns A consistent friendship ID in the format "user1_user2" where user1 and user2 are sorted alphabetically
 */
export const createFriendshipId = (userId1: string, userId2: string): string => {
  const userIds = [userId1, userId2].sort();
  return `${userIds[0]}_${userIds[1]}`;
};

/**
 * Checks if a user has reached the combined limit of friends and active invitations
 * @param userId The user ID to check
 * @returns An object containing the friend count, active invitation count, and whether the limit has been reached
 */
export const hasReachedCombinedLimit = async (
  userId: string,
): Promise<{
  friendCount: number;
  hasReachedLimit: boolean;
}> => {
  const db = getFirestore();

  // Get all friendships where the user is either the sender or receiver
  const friendshipsQuery = await db
    .collection(Collections.FRIENDSHIPS)
    .where(FriendshipFields.MEMBERS, QueryOperators.ARRAY_CONTAINS, userId)
    .get();

  const friendCount = friendshipsQuery.size;

  return {
    friendCount,
    hasReachedLimit: friendCount >= MAX_COMBINED,
  };
};

/**
 * Copies public updates from sourceUserId to targetUserId's feed and generates a friend summary for targetUserId.
 * Handles batching and commits internally. Can be run in parallel for each direction.
 *
 * @param sourceUserId - The user whose updates are being shared
 * @param targetUserId - The user who will receive feed items and summary
 * @param friendshipData - The data associated with the friendship
 */
export async function syncFriendshipDataForUser(
  sourceUserId: string,
  targetUserId: string,
  friendshipData: FirebaseFirestore.DocumentData,
): Promise<{ emoji?: string; updatedAt?: FirebaseFirestore.Timestamp } | undefined> {
  try {
    const db = getFirestore();
    const updatesQuery = db
      .collection(Collections.UPDATES)
      .where(UpdateFields.CREATED_BY, QueryOperators.EQUALS, sourceUserId)
      .where(UpdateFields.ALL_VILLAGE, QueryOperators.EQUALS, true)
      .orderBy(UpdateFields.CREATED_AT, QueryOperators.DESC);

    // Create a batch for atomic operations
    let batch = db.batch();
    let batchCount = 0;
    let totalProcessed = 0;

    // Store the last 10 updates for friend summary processing
    const lastUpdates: FirebaseFirestore.DocumentData[] = [];
    let latestEmoji: string | undefined = undefined;
    let latestUpdateAt: FirebaseFirestore.Timestamp | undefined = undefined;

    // Stream the updates instead of getting them all at once
    logger.info(`Streaming all_village updates from sender ${sourceUserId}`);

    // Process each update document in the stream
    for await (const doc of updatesQuery.stream()) {
      const updateDoc = doc as unknown as QueryDocumentSnapshot;
      const updateData = updateDoc.data();
      const updateId = updateDoc.id;
      const createdAt = updateData[UpdateFields.CREATED_AT];

      // Add the ID to the update data
      updateData[UpdateFields.ID] = updateId;

      // Capture data from the very first update (latest)
      if (latestEmoji === undefined) {
        latestEmoji = (updateData[UpdateFields.EMOJI] as string) || '';
        latestUpdateAt = createdAt as FirebaseFirestore.Timestamp;
      }

      // Add to the list of last updates (we'll keep only the first 10)
      if (lastUpdates.length < 10) {
        lastUpdates.push(updateData);
      }

      // Use the utility function to create the feed item
      createFeedItem(db, batch, targetUserId, updateId, createdAt, true, sourceUserId, [], sourceUserId);

      // Update the update document's visible_to array to include the target user
      const targetUserVisibilityId = createFriendVisibilityIdentifier(targetUserId);
      const currentVisibleTo = updateData[UpdateFields.VISIBLE_TO] || [];

      // Only add if not already present
      if (!currentVisibleTo.includes(targetUserVisibilityId)) {
        const updateRef = db.collection(Collections.UPDATES).doc(updateId);
        batch.update(updateRef, {
          [UpdateFields.VISIBLE_TO]: [...currentVisibleTo, targetUserVisibilityId],
        });
        batchCount++; // Account for the additional batch operation
      }

      batchCount++;
      totalProcessed++;

      // Commit the batch if it reaches the maximum size
      if (batchCount >= MAX_BATCH_OPERATIONS) {
        await batch.commit();
        logger.info(`Committed batch with ${batchCount} feed items`);
        batchCount = 0;
        // Create a new batch
        batch = db.batch();
      }
    }

    // Commit any remaining operations in the batch
    if (batchCount > 0) {
      await batch.commit();
      logger.info(`Committed final batch with ${batchCount} feed items`);
    }

    logger.info(`Created ${totalProcessed} feed items for receiver ${targetUserId}`);

    if (totalProcessed === 0) {
      logger.info(`No all_village updates found for sender ${sourceUserId}`);
      return;
    }

    // Process friend summaries for the last 10 updates from oldest to newest
    // Reverse the array to process from oldest to newest
    lastUpdates.reverse();

    // Get the summary context once at the beginning
    const summaryContext = await getSummaryContext(db, sourceUserId, targetUserId);

    // Create a single batch for all summary updates
    const summaryBatch = db.batch();

    // Track all friend summary events
    const friendSummaryEvents: FriendSummaryEventParams[] = [];

    // Keep track of the latest summary result
    let latestSummaryResult: SummaryResult | null = null;

    // Process each update for friend summary
    for (const updateData of lastUpdates) {
      // Process images for this update
      const imagePaths = (updateData[UpdateFields.IMAGE_PATHS] as string[]) || [];
      const processedImages = await processImagesForPrompt(imagePaths);

      // Analyze images for this update
      const { analysis: imageAnalysis } = await analyzeImagesFlow({ images: processedImages });

      // Generate the summary
      const summaryResult = await generateFriendSummary(summaryContext, updateData, imageAnalysis);

      summaryContext.existingSummary = summaryResult.summary;
      summaryContext.existingSuggestions = summaryResult.suggestions;
      // Store the latest result
      latestSummaryResult = summaryResult;

      // Add to the events to track
      friendSummaryEvents.push(summaryResult.analytics);
    }

    // Write the final summary to the database
    if (latestSummaryResult) {
      writeFriendSummary(summaryContext, latestSummaryResult, sourceUserId, targetUserId, summaryBatch);

      // Commit the batch with the final summary
      await summaryBatch.commit();
      logger.info(`Processed friend summaries for ${lastUpdates.length} updates`);

      // Track all the friend summary events
      trackApiEvents(
        friendSummaryEvents.map((params) => ({
          eventName: EventName.FRIEND_SUMMARY_CREATED,
          params,
        })),
        sourceUserId,
      );
    }

    logger.info(`Successfully processed friendship ${friendshipData.id}`);
    return { emoji: latestEmoji, updatedAt: latestUpdateAt };
  } catch (error) {
    logger.error(`Error processing friendship ${friendshipData.id}: ${error}`);
    // In a production environment, we would implement retry logic here
    return undefined;
  }
}

/**
 * Upserts a friend document in /profiles/{uid}/friends/{friendUid}
 */
export const upsertFriendDoc = async (
  db: FirebaseFirestore.Firestore,
  userId: string,
  friendUserId: string,
  data: FriendDocUpdate,
  batch?: FirebaseFirestore.WriteBatch,
): Promise<void> => {
  const friendRef = db.collection(Collections.PROFILES).doc(userId).collection(Collections.FRIENDS).doc(friendUserId);

  const now = Timestamp.now();
  const payload: UpdateData<FirebaseFirestore.DocumentData> = {};
  if (data.username) payload[FriendDocFields.USERNAME] = data.username;
  if (data.name) payload[FriendDocFields.NAME] = data.name;
  if (data.avatar) payload[FriendDocFields.AVATAR] = data.avatar;
  if (data.last_update_emoji) payload[FriendDocFields.LAST_UPDATE_EMOJI] = data.last_update_emoji;
  if (data.last_update_at) payload[FriendDocFields.LAST_UPDATE_AT] = data.last_update_at;

  if (Object.keys(payload).length === 0) {
    return; // nothing to update
  }

  // always touch updated_at when we have changes
  payload[FriendDocFields.UPDATED_AT] = now;

  const write = (b: FirebaseFirestore.WriteBatch) => {
    b.set(friendRef, { [FriendDocFields.CREATED_AT]: now, ...payload }, { merge: true });
  };

  if (batch) {
    write(batch);
  } else {
    const b = db.batch();
    write(b);
    await b.commit();
  }
};

/**
 * Migrates all friendship documents for a user into friend subcollection (idempotent).
 */
export const migrateFriendDocsForUser = async (userId: string): Promise<void> => {
  const db = getFirestore();

  // Check if subcollection has any docs
  const existingSnap = await db
    .collection(Collections.PROFILES)
    .doc(userId)
    .collection(Collections.FRIENDS)
    .limit(1)
    .get();
  if (!existingSnap.empty) {
    return; // already migrated
  }

  const query = db
    .collection(Collections.FRIENDSHIPS)
    .where(FriendshipFields.MEMBERS, QueryOperators.ARRAY_CONTAINS, userId);

  const batch = db.batch();
  let count = 0;
  for await (const doc of query.stream()) {
    const snap = doc as unknown as QueryDocumentSnapshot;
    const d = snap.data();
    const isSender = d[FriendshipFields.SENDER_ID] === userId;
    const friendId = isSender ? d[FriendshipFields.RECEIVER_ID] : d[FriendshipFields.SENDER_ID];
    if (!friendId) return;
    const friendData = {
      username: isSender ? d[FriendshipFields.RECEIVER_USERNAME] : d[FriendshipFields.SENDER_USERNAME],
      name: isSender ? d[FriendshipFields.RECEIVER_NAME] : d[FriendshipFields.SENDER_NAME],
      avatar: isSender ? d[FriendshipFields.RECEIVER_AVATAR] : d[FriendshipFields.SENDER_AVATAR],
      last_update_emoji: isSender
        ? d[FriendshipFields.RECEIVER_LAST_UPDATE_EMOJI]
        : d[FriendshipFields.SENDER_LAST_UPDATE_EMOJI],
    };
    upsertFriendDoc(db, userId, friendId, friendData, batch);
    count++;
  }

  await batch.commit();
  logger.info(`Migrated ${count} friendships to friend docs for user ${userId}`);
};
