import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { Change, FirestoreEvent } from 'firebase-functions/v2/firestore';
import { analyzeImagesFlow } from '../ai/flows.js';
import { EventName, FriendSummaryEventParams } from '../models/analytics-events.js';
import { Collections } from '../models/constants.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getFriendDoc, upsertFriendDoc, type FriendDocUpdate } from '../utils/friendship-utils.js';
import { processImagesForPrompt } from '../utils/image-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { processFriendSummary } from '../utils/summary-utils.js';
import { createFeedItem } from '../utils/update-utils.js';
import { groupConverter, UpdateDoc } from '../models/firestore/index.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Processes newly added friends and groups when an update is shared.
 *
 * @param db - Firestore client
 * @param updateData - The update document data
 * @param newFriendIds - Array of newly added friend IDs
 * @param newGroupIds - Array of newly added group IDs
 * @param updateId - The ID of the update
 * @param imageAnalysis - Already analyzed image description text
 * @returns Analytics data about the friend summary processing
 */
const processNewlyAddedFriendsAndGroups = async (
  db: FirebaseFirestore.Firestore,
  updateData: UpdateDoc,
  newFriendIds: string[],
  newGroupIds: string[],
  updateId: string,
  imageAnalysis: string,
): Promise<FriendSummaryEventParams[]> => {
  if (newFriendIds.length === 0 && newGroupIds.length === 0) {
    return [];
  }

  const creatorId = updateData.created_by;
  const emoji = updateData.emoji;
  const createdAt = updateData.created_at;

  // Create a batch for atomic writes
  const batch = db.batch();

  // Create tasks for all newly added friends and groups
  const tasks = [];

  // Get all users who should see this update through newly added groups
  const groupMembersMap = new Map<string, Set<string>>();
  const allNewUsers = new Set<string>();

  // Add new friends directly
  newFriendIds.forEach((friendId) => allNewUsers.add(friendId));

  // Get group members for newly added groups
  if (newGroupIds.length > 0) {
    const groups = db.collection(Collections.GROUPS).withConverter(groupConverter);
    const groupDocs = await Promise.all(newGroupIds.map((groupId) => groups.doc(groupId).get()));

    groupDocs.forEach((groupDoc) => {
      const groupData = groupDoc.data();
      if (groupData) {
        const members = new Set(groupData.members);
        groupMembersMap.set(groupDoc.id, members);
        members.forEach((memberId) => allNewUsers.add(memberId));
      }
    });
  }

  // Remove the creator from the list of users to process
  allNewUsers.delete(creatorId);

  // Process friend summaries for newly added users
  for (const userId of allNewUsers) {
    // Only process friend summaries for direct friends
    if (newFriendIds.includes(userId)) {
      tasks.push(processFriendSummary(db, updateData, creatorId, userId, batch, imageAnalysis));
    }
  }

  // Update friend documents with emoji for newly added direct friends
  if (emoji && newFriendIds.length > 0) {
    const friendshipUpdateTasks = newFriendIds.map(async (friendId) => {
      // Check if they are friends using the new system
      const friendDocResult = await getFriendDoc(creatorId, friendId);

      if (friendDocResult) {
        const friendDocUpdate: FriendDocUpdate = {
          last_update_emoji: emoji,
          last_update_at: createdAt,
        };
        upsertFriendDoc(db, friendId, creatorId, friendDocUpdate, batch);
      }
      // If not friends, just skip - no error needed
    });
    tasks.push(...friendshipUpdateTasks);
  }

  // Create feed items for all newly added users
  for (const userId of allNewUsers) {
    // Determine how this user can see the update
    const isDirectFriend = newFriendIds.includes(userId);
    const userGroups = newGroupIds.filter((groupId) => groupMembersMap.get(groupId)?.has(userId));

    createFeedItem(
      db,
      batch,
      userId,
      updateId,
      createdAt,
      isDirectFriend,
      isDirectFriend ? creatorId : null,
      userGroups,
      creatorId,
    );
  }

  // Run all tasks in parallel
  const results = await Promise.all(tasks);

  // Commit the batch
  if (tasks.length > 0) {
    await batch.commit();
    logger.info(`Committed batch with ${tasks.length} updates for newly shared friends and groups`);
  }

  // Filter and return only friend summary results
  const friendResults = results.filter(
    (result) => result && typeof result === 'object' && 'summary_length' in result,
  ) as FriendSummaryEventParams[];

  return friendResults;
};

/**
 * Detects which friends and groups were newly added by comparing old and new lists.
 *
 * @param oldFriendIds - Previous friend IDs array
 * @param newFriendIds - Current friend IDs array
 * @param oldGroupIds - Previous group IDs array
 * @param newGroupIds - Current group IDs array
 * @returns Object with arrays of newly added friend and group IDs
 */
const detectNewlyAddedFriendsAndGroups = (
  oldFriendIds: string[],
  newFriendIds: string[],
  oldGroupIds: string[],
  newGroupIds: string[],
): { addedFriends: string[]; addedGroups: string[] } => {
  const addedFriends = newFriendIds.filter((friendId) => !oldFriendIds.includes(friendId));
  const addedGroups = newGroupIds.filter((groupId) => !oldGroupIds.includes(groupId));

  return { addedFriends, addedGroups };
};

/**
 * Firestore trigger function that runs when an update document is modified.
 * Only processes changes when friends or groups are added to the update.
 *
 * @param event - The Firestore event object containing the document data
 */
export const onUpdateUpdated = async (
  event: FirestoreEvent<Change<QueryDocumentSnapshot> | undefined, { id: string }>,
): Promise<void> => {
  if (!event.data) {
    logger.error('No data in update share event');
    return;
  }

  const beforeData = (event.data.before?.data() || {}) as UpdateDoc;
  const afterData = (event.data.after?.data() || {}) as UpdateDoc;
  const updateId = event.params.id;

  if (!updateId) {
    logger.error('No update ID found in event');
    return;
  }

  // Compare friend and group lists to detect newly added ones
  const oldFriendIds = beforeData.friend_ids || [];
  const newFriendIds = afterData.friend_ids || [];
  const oldGroupIds = beforeData.group_ids || [];
  const newGroupIds = afterData.group_ids || [];

  const { addedFriends, addedGroups } = detectNewlyAddedFriendsAndGroups(
    oldFriendIds,
    newFriendIds,
    oldGroupIds,
    newGroupIds,
  );

  if (addedFriends.length === 0 && addedGroups.length === 0) {
    logger.info(`No new friends or groups added to update ${updateId}, skipping processing`);
    return;
  }

  logger.info(
    `Processing update share for update ${updateId}: ${addedFriends.length} new friends and ${addedGroups.length} new groups added`,
  );

  // Add the document ID to the update data
  const updateData: UpdateDoc = { ...afterData, id: updateId };

  // Initialize Firestore client
  const db = getFirestore();

  try {
    // Process images for analysis
    const imagePaths = updateData.image_paths || [];
    const processedImages = await processImagesForPrompt(imagePaths);

    // Analyze images for friend summaries
    const { analysis: imageAnalysis } = await analyzeImagesFlow({ images: processedImages });

    // Process newly added friends and groups
    const friendSummaries = await processNewlyAddedFriendsAndGroups(
      db,
      updateData,
      addedFriends,
      addedGroups,
      updateId,
      imageAnalysis,
    );

    logger.info(
      `Successfully processed update share for ${updateId} with ${addedFriends.length} new friends and ${addedGroups.length} new groups`,
    );

    // Track analytics events
    const events = friendSummaries.map((summary) => ({
      eventName: EventName.FRIEND_SUMMARY_CREATED,
      params: summary,
    }));

    if (events.length > 0) {
      trackApiEvents(events, updateData.created_by);
      logger.info(`Tracked ${events.length} friend summary analytics events`);
    }
  } catch (error) {
    logger.error(`Error processing update share for ${updateId}: ${error}`);
  }
};
