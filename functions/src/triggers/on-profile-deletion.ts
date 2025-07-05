import { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { FirestoreEvent } from 'firebase-functions/v2/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { DeleteProfileEventParams, EventName } from '../models/analytics-events.js';
import { ProfileDoc } from '../models/firestore/profile-doc.js';
import {
  DeviceService,
  FriendshipService,
  GroupService,
  InvitationService,
  ProfileService,
  UpdateService,
} from '../services/index.js';
import { trackApiEvent } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Firestore trigger function that runs when a profile is deleted.
 * Uses service orchestration pattern to handle cascade deletion and analytics tracking.
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
  try {
    if (!event.data) {
      logger.error('No data in profile deletion event');
      return;
    }

    const userId = event.params.id;
    const profileData = event.data.data() as ProfileDoc;

    logger.info(`Processing profile deletion for user: ${userId}`);

    // Initialize all services
    const friendshipService = new FriendshipService();
    const groupService = new GroupService();
    const updateService = new UpdateService();
    const invitationService = new InvitationService();
    const deviceService = new DeviceService();
    const profileService = new ProfileService();

    // Execute all cleanup operations in parallel
    const [friendshipResult, groupResult, updateResult, invitationResult, deviceResult, summaryResult] =
      await Promise.all([
        friendshipService.removeUserFromAllFriendships(userId, profileData.friends_to_cleanup || []),
        groupService.removeUserFromAllGroups(userId),
        updateService.deleteUserUpdatesAndFeeds(userId),
        invitationService.deleteUserInvitations(userId),
        deviceService.deleteDevice(userId),
        profileService.deleteUserSummaries(userId),
        profileService.removeFromTimeBuckets(userId),
        profileService.deleteStorageAssets(userId),
      ]);

    // Collect analytics data
    const analyticsData: DeleteProfileEventParams = {
      update_count: updateResult.updateCount,
      feed_count: updateResult.feedCount,
      friend_count: friendshipResult,
      summary_count: summaryResult,
      group_count: groupResult,
      device_count: deviceResult,
      invitation_count: invitationResult,
    };

    // Track analytics event
    await trackApiEvent(EventName.PROFILE_DELETED, userId, analyticsData);
    logger.info(`Tracked delete profile analytics: ${JSON.stringify(analyticsData)}`);

    logger.info(`Successfully processed profile deletion for user ${userId}`);
  } catch (error) {
    logger.error(`Error processing profile deletion:`, error);
  }
};
