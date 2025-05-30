import { Request } from 'express';
import { ApiResponse, EventName, InviteEventParams } from '../models/analytics-events.js';
import { Invitation } from '../models/data-models.js';
import { hasReachedCombinedLimit } from '../utils/friendship-utils.js';
import { formatInvitation, getOrCreateInvitationLink } from '../utils/invitation-utils.js';
import { getLogger } from '../utils/logging-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';
import { getProfileDoc } from '../utils/profile-utils.js';
import { ProfileFields } from '../models/constants.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Gets a single invitation by ID.
 *
 * This function:
 * 1. Retrieves the invitation document by ID
 * 2. Returns the invitation data
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Request parameters containing:
 *                - invitation_id: The ID of the invitation to retrieve
 *
 * @returns An ApiResponse containing the invitation and analytics
 *
 * @throws 404: Invitation not found
 */
export const getInvitation = async (req: Request): Promise<ApiResponse<Invitation>> => {
  const currentUserId = req.userId;

  logger.info(`Getting invitation for user ${currentUserId}`);

  // Get user profile data
  const { data: profileData } = await getProfileDoc(currentUserId);

  // Create a new invitation
  const { ref, data } = await getOrCreateInvitationLink(currentUserId, {
    name: profileData[ProfileFields.NAME] as string,
    username: profileData[ProfileFields.USERNAME] as string,
    avatar: profileData[ProfileFields.AVATAR] as string,
  });

  // Format the invitation
  const invitation = formatInvitation(ref.id, data);

  // Get current friend and invitation counts for analytics
  const { friendCount } = await hasReachedCombinedLimit(currentUserId);

  // Create analytics event
  const event: InviteEventParams = {
    friend_count: friendCount,
  };

  logger.info(`Successfully reset invitation for user ${currentUserId}`);

  // Return the new invitation
  return {
    data: invitation,
    status: 200,
    analytics: {
      event: EventName.INVITE_VIEWED,
      userId: currentUserId,
      params: event,
    },
  };
};
