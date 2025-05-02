import { Request } from 'express';
import {
  ApiResponse,
  EventName,
  InviteEventParams,
} from '../models/analytics-events';
import { InvitationFields, Status } from '../models/constants';
import { Invitation } from '../models/data-models';
import { BadRequestError } from '../utils/errors';
import { hasReachedCombinedLimit } from '../utils/friendship-utils';
import {
  canActOnInvitation,
  formatInvitation,
  getInvitationDoc,
  hasInvitationPermission,
  updateInvitationStatus,
} from '../utils/invitation-utils';
import { getLogger } from '../utils/logging-utils';

const logger = getLogger(__filename);

/**
 * Rejects an invitation by setting its status to rejected.
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: The route parameters containing:
 *                - invitation_id: The ID of the invitation to reject
 *
 * @returns An ApiResponse containing the updated invitation and analytics
 *
 * @throws {400} Invitation cannot be rejected (status: {status})
 * @throws {400} You cannot reject your own invitation
 * @throws {404} Invitation not found
 */
export const rejectInvitation = async (
  req: Request,
): Promise<ApiResponse<Invitation>> => {
  const currentUserId = req.userId;
  const invitationId = req.params.invitation_id;
  logger.info(`User ${currentUserId} rejecting invitation ${invitationId}`);

  if (!invitationId) {
    throw new BadRequestError("Invitation ID is required");
  }

  // Get the invitation document
  const { ref: invitationRef, data: invitationData } =
    await getInvitationDoc(invitationId);

  // Check invitation status
  const status = invitationData[InvitationFields.STATUS];
  canActOnInvitation(status, 'reject');

  // Get the sender's user ID and ensure current user is not the sender
  const senderId = invitationData[InvitationFields.SENDER_ID];
  hasInvitationPermission(senderId, currentUserId, 'reject');

  // Get current friend and invitation counts for analytics
  const { friendCount, activeInvitationCount } =
    await hasReachedCombinedLimit(currentUserId);

  // Update the invitation status to rejected
  await updateInvitationStatus(invitationRef, Status.REJECTED);

  logger.info(`User ${currentUserId} rejected invitation ${invitationId}`);

  // Return the updated invitation
  const invitation = formatInvitation(invitationId, {
    ...invitationData,
    [InvitationFields.STATUS]: Status.REJECTED,
  });

  // Create analytics event
  const event: InviteEventParams = {
    friend_count: friendCount,
    invitation_count: activeInvitationCount,
  };

  return {
    data: invitation,
    status: 200,
    analytics: {
      event: EventName.INVITE_REJECTED,
      userId: currentUserId,
      params: event,
    },
  };
};
