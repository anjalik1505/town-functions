import { Request } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { ApiResponse, EventName, InviteResetEventParams } from '../models/analytics-events.js';
import { Collections, ProfileFields } from '../models/constants.js';
import { Invitation } from '../models/data-models.js';
import { hasReachedCombinedLimit } from '../utils/friendship-utils.js';
import { formatInvitation, getOrCreateInvitationLink } from '../utils/invitation-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { getProfileDoc } from '../utils/profile-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Resets the invitation for the current user by deleting the old one and creating a new one.
 *
 * This function:
 * 1. Finds the user's existing invitation
 * 2. Uses recursiveDelete to delete the invitation and all its join request subcollections
 * 3. Creates a new invitation
 * 4. Returns the new invitation data
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *
 * @returns An ApiResponse containing the new invitation and analytics
 */
export const resetInvitation = async (req: Request): Promise<ApiResponse<Invitation>> => {
  const currentUserId = req.userId;

  logger.info(`Resetting invitation for user ${currentUserId}`);

  // Get user profile data
  const { data: profileData } = await getProfileDoc(currentUserId);

  const db = getFirestore();

  // Find the user's existing invitation (should be at userId document)
  const invitationRef = db.collection(Collections.INVITATIONS).doc(currentUserId);
  const invitationDoc = await invitationRef.get();

  let joinRequestsDeleted = 0;

  // Delete the invitation and all its subcollections if it exists
  if (invitationDoc.exists) {
    logger.info(`Found existing invitation for user ${currentUserId}, deleting it and all join requests`);

    try {
      // Count the number of join requests first for analytics
      const joinRequestsSnapshot = await invitationRef.collection(Collections.JOIN_REQUESTS).count().get();
      joinRequestsDeleted = joinRequestsSnapshot.data().count;
    } catch (error) {
      logger.error(`Error deleting invitation: ${error}`);
    }

    // Use recursiveDelete to delete the invitation document and all its subcollections
    await db.recursiveDelete(invitationRef);
    logger.info(`Deleted invitation for user ${currentUserId} and ${joinRequestsDeleted} join requests`);
  }

  // Create a new invitation
  const { ref, data } = await getOrCreateInvitationLink(currentUserId, {
    name: profileData[ProfileFields.NAME] as string,
    username: profileData[ProfileFields.USERNAME] as string,
    avatar: profileData[ProfileFields.AVATAR] as string,
  });

  // Format the invitation
  const invitation = formatInvitation(ref.id, data);

  // Get current friend count for analytics
  const { friendCount } = await hasReachedCombinedLimit(currentUserId);

  // Create analytics event
  const event: InviteResetEventParams = {
    friend_count: friendCount,
    join_requests_deleted: joinRequestsDeleted,
  };

  logger.info(`Successfully reset invitation for user ${currentUserId}`);

  // Return the new invitation
  return {
    data: invitation,
    status: 200,
    analytics: {
      event: EventName.INVITE_RESET,
      userId: currentUserId,
      params: event,
    },
  };
};
