import { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FirestoreEvent } from 'firebase-functions/v2/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventName } from '../models/analytics-events.js';
import { UpdateDoc, uf } from '../models/firestore/update-doc.js';
import { AiService } from '../services/ai-service.js';
import { FriendshipService } from '../services/friendship-service.js';
import { ProfileService } from '../services/profile-service.js';
import { UpdateService } from '../services/update-service.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Firestore trigger function that runs when a new update is created.
 * Uses the orchestration pattern with ProfileService and FriendshipService for AI processing.
 *
 * @param event - The Firestore event object containing the document data
 */
export const onUpdateCreated = async (
  event: FirestoreEvent<
    QueryDocumentSnapshot | undefined,
    {
      id: string;
    }
  >,
): Promise<void> => {
  try {
    const updateSnapshot = event.data;

    if (!updateSnapshot) {
      logger.error('No update data in event');
      return;
    }

    // Convert to typed document
    const updateData = updateSnapshot.data() as UpdateDoc;

    if (!updateData) {
      logger.error('Update data is null');
      return;
    }

    // Add the document ID to the update data
    updateData[uf('id')] = updateSnapshot.id;

    logger.info(`Processing update creation: ${updateSnapshot.id}`);

    const creatorId = updateData[uf('created_by')];
    if (!creatorId) {
      logger.error(`No creator ID found for update ${updateSnapshot.id}`);
      return;
    }

    // Initialize services
    const aiService = new AiService();
    const updateService = new UpdateService();
    const profileService = new ProfileService();
    const friendshipService = new FriendshipService();

    // Update user's last update time in time buckets for notification eligibility
    await profileService.updateUserLastUpdateTime(creatorId, updateData[uf('created_at')]);

    // Process images once and store in update document
    const imagePaths = updateData[uf('image_paths')] || [];
    const imageAnalysis = await aiService.processAndAnalyzeImages(imagePaths);

    // Store image analysis in the update document if we have analysis
    if (imageAnalysis) {
      await updateService.updateImageAnalysis(updateSnapshot.id, imageAnalysis);
    }

    // Process creator profile updates using ProfileService
    const mainSummary = await profileService.processUpdateCreatorProfile(updateData, imageAnalysis);

    // Process friend summaries using FriendshipService
    const friendSummaries = await friendshipService.processUpdateFriendSummaries(updateData, imageAnalysis);

    // Track all analytics events
    const events = [
      {
        eventName: EventName.SUMMARY_CREATED,
        params: mainSummary,
      },
      ...friendSummaries.map((summary) => ({
        eventName: EventName.FRIEND_SUMMARY_CREATED,
        params: summary,
      })),
    ];

    await trackApiEvents(events, creatorId);

    logger.info(`Successfully processed update creation for update ${updateSnapshot.id}`);
  } catch (error) {
    logger.error(`Error processing update creation:`, error);
  }
};
