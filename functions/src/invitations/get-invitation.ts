import { Request } from 'express';
import { ApiResponse, EventName, InviteEventParams } from '../models/analytics-events.js';
import { Invitation } from '../models/data-models.js';
import { BadRequestError } from '../utils/errors.js';
import { hasReachedCombinedLimit } from '../utils/friendship-utils.js';
import { formatInvitation, getInvitationDoc } from '../utils/invitation-utils.js';
import { getLogger } from '../utils/logging-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

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
  const invitationId = req.params.invitation_id;

  logger.info(`Getting invitation ${invitationId} for user ${currentUserId}`);

  if (!invitationId) {
    throw new BadRequestError('Invitation ID is required');
  }

  // Get the invitation document
  const { data: invitationData } = await getInvitationDoc(invitationId);

  // Get current friend and invitation counts for analytics
  const { friendCount, activeInvitationCount } = await hasReachedCombinedLimit(currentUserId);

  // Format the invitation
  const invitation = formatInvitation(invitationId, invitationData);

  logger.info(`Successfully retrieved invitation ${invitationId} for user ${currentUserId}`);

  // Create analytics event
  const event: InviteEventParams = {
    friend_count: friendCount,
    invitation_count: activeInvitationCount,
  };

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
