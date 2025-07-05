import { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { Change, FirestoreEvent } from 'firebase-functions/v2/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventName } from '../models/analytics-events.js';
import { UpdateDoc, uf } from '../models/firestore/index.js';
import { FriendshipService } from '../services/friendship-service.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Firestore trigger function that runs when an update document is modified.
 * Uses the orchestration pattern with UpdateService and FriendshipService.
 * Only processes changes when friends or groups are added to the update.
 *
 * @param event - The Firestore event object containing the document data
 */
export const onUpdateUpdated = async (
  event: FirestoreEvent<Change<QueryDocumentSnapshot> | undefined, { id: string }>,
): Promise<void> => {
  try {
    if (!event.data) {
      logger.error('No data in update update event');
      return;
    }

    const beforeSnapshot = event.data.before;
    const afterSnapshot = event.data.after;

    if (!beforeSnapshot || !afterSnapshot) {
      logger.error('Missing before or after data in update event');
      return;
    }

    // Convert to typed documents
    const beforeData = beforeSnapshot.data() as UpdateDoc;
    const afterData = afterSnapshot.data() as UpdateDoc;

    if (!beforeData || !afterData) {
      logger.error('Update data is null');
      return;
    }

    // Extract ID from parameter
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

    const addedFriends = newFriendIds.filter((friendId) => !oldFriendIds.includes(friendId));
    const addedGroups = newGroupIds.filter((groupId) => !oldGroupIds.includes(groupId));

    if (addedFriends.length === 0 && addedGroups.length === 0) {
      logger.info(`No new friends or groups added to update ${updateId}, skipping processing`);
      return;
    }

    logger.info(
      `Processing update sharing changes for update ${updateId}: ${addedFriends.length} new friends and ${addedGroups.length} new groups added`,
    );

    // Add document ID to the update data
    const updateDataWithId: UpdateDoc = { ...afterData, id: updateId };

    // Initialize services
    const friendshipService = new FriendshipService();

    // Use stored image analysis or fallback to processing images
    const imageAnalysis = updateDataWithId[uf('image_analysis')] || '';

    // Process friend summaries using FriendshipService
    const friendSummaries = await friendshipService.processUpdateFriendSummaries(updateDataWithId, imageAnalysis);

    // Track analytics events
    const events = friendSummaries.map((summary) => ({
      eventName: EventName.FRIEND_SUMMARY_CREATED,
      params: summary,
    }));

    if (events.length > 0) {
      await trackApiEvents(events, afterData.created_by);
      logger.info(`Tracked ${events.length} friend summary analytics events`);
    }

    logger.info(`Successfully processed update sharing changes for update ${updateId}`);
  } catch (error) {
    logger.error(`Error processing update sharing changes:`, error);
  }
};
