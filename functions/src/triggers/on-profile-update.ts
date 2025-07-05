import { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { Change, FirestoreEvent } from 'firebase-functions/v2/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventName } from '../models/analytics-events.js';
import { ProfileDoc } from '../models/firestore/profile-doc.js';
import { CreatorProfile } from '../models/firestore/update-doc.js';
import { FriendshipService } from '../services/friendship-service.js';
import { GroupService } from '../services/group-service.js';
import { InvitationService } from '../services/invitation-service.js';
import { ProfileService } from '../services/profile-service.js';
import { UpdateService } from '../services/update-service.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Firestore trigger function that runs when a profile document is updated.
 * Uses service orchestration pattern to update denormalized profile data across all collections.
 *
 * @param event - The Firestore event object containing the document data
 */
export const onProfileUpdate = async (
  event: FirestoreEvent<Change<QueryDocumentSnapshot> | undefined, { userId: string }>,
): Promise<void> => {
  try {
    if (!event.data) {
      logger.error('No data in profile update event');
      return;
    }

    const { userId } = event.params;
    const before = event.data.before;
    const after = event.data.after;

    if (!before || !after) {
      logger.error('Missing before or after data in profile update');
      return;
    }

    // Convert the snapshots to typed documents
    const beforeData = before.data() as ProfileDoc;
    const afterData = after.data() as ProfileDoc;

    if (!beforeData || !afterData) {
      logger.error('Missing data in profile documents');
      return;
    }

    logger.info(`Processing profile update for user ${userId}`);

    // Check if denormalizable fields have changed
    const profileFieldsChanged =
      beforeData.username !== afterData.username ||
      beforeData.name !== afterData.name ||
      beforeData.avatar !== afterData.avatar;

    const phoneChanged = beforeData.phone_number !== afterData.phone_number;

    // Phone mappings need to be updated if either phone changed OR profile fields changed
    const phoneRelatedFieldsChanged = phoneChanged || profileFieldsChanged;

    if (!phoneRelatedFieldsChanged) {
      logger.info(`No denormalizable fields changed for user ${userId}, skipping denormalization`);
      return;
    }

    // Initialize services
    const profileService = new ProfileService();
    const updateService = new UpdateService();
    const groupService = new GroupService();
    const invitationService = new InvitationService();
    const friendshipService = new FriendshipService();

    // Prepare profile data for denormalization
    const newProfile: CreatorProfile = {
      username: afterData.username || '',
      name: afterData.name || '',
      avatar: afterData.avatar || '',
    };

    // Track denormalization results
    let totalUpdates = 0;
    const analyticsResults = {
      phone_mappings_updated: 0,
      updates_updated: 0,
      groups_updated: 0,
      invitations_updated: 0,
      friendships_updated: 0,
    };

    try {
      // Process phone mapping changes (ProfileService domain)
      // This handles both phone changes AND profile field changes
      if (phoneRelatedFieldsChanged) {
        const phoneUpdates = await profileService.updatePhoneMappingDenormalization(userId, beforeData, afterData);
        analyticsResults.phone_mappings_updated = phoneUpdates;
        totalUpdates += phoneUpdates;
        logger.info(`Updated ${phoneUpdates} phone mappings for user ${userId}`);
      }

      // Process profile field changes for other collections
      if (profileFieldsChanged) {
        // Process updates denormalization (UpdateService domain)
        const updateUpdates = await updateService.updateProfileDenormalization(userId, newProfile);
        analyticsResults.updates_updated = updateUpdates;
        totalUpdates += updateUpdates;
        logger.info(`Updated ${updateUpdates} update profiles for user ${userId}`);

        // Process groups denormalization (GroupService domain)
        const groupUpdates = await groupService.updateMemberProfileDenormalization(userId, newProfile);
        analyticsResults.groups_updated = groupUpdates;
        totalUpdates += groupUpdates;
        logger.info(`Updated ${groupUpdates} group member profiles for user ${userId}`);

        // Process invitations denormalization (InvitationService domain)
        const invitationUpdates = await invitationService.updateProfileDenormalization(userId, newProfile);
        analyticsResults.invitations_updated = invitationUpdates;
        totalUpdates += invitationUpdates;
        logger.info(`Updated ${invitationUpdates} invitation profiles for user ${userId}`);

        // Process friendships denormalization (FriendshipService domain)
        const friendshipUpdates = await friendshipService.updateFriendProfileDenormalization(userId, newProfile);
        analyticsResults.friendships_updated = friendshipUpdates;
        totalUpdates += friendshipUpdates;
        logger.info(`Updated ${friendshipUpdates} friendship profiles for user ${userId}`);
      }

      // Track aggregated analytics
      await trackApiEvents(
        [
          {
            eventName: EventName.PROFILE_UPDATED,
            params: {
              total_updates: totalUpdates,
              phone_mappings_updated: analyticsResults.phone_mappings_updated,
              updates_updated: analyticsResults.updates_updated,
              groups_updated: analyticsResults.groups_updated,
              invitations_updated: analyticsResults.invitations_updated,
              friendships_updated: analyticsResults.friendships_updated,
            },
          },
        ],
        userId,
      );

      logger.info(`Successfully processed profile update for user ${userId} - total updates: ${totalUpdates}`);
    } catch (error) {
      logger.error(`Error during denormalization for user ${userId}:`, error);
      throw error;
    }
  } catch (error) {
    logger.error(`Error processing profile update:`, error);
  }
};
