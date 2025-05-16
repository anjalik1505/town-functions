import { Request } from 'express';
import { DocumentData, getFirestore, Timestamp, UpdateData, } from 'firebase-admin/firestore';
import { ApiResponse, EventName, InviteEventParams, } from '../models/analytics-events.js';
import { Collections, InvitationFields, Status } from '../models/constants.js';
import { Invitation } from '../models/data-models.js';
import { BadRequestError, ForbiddenError, NotFoundError, } from '../utils/errors.js';
import { hasReachedCombinedLimit } from '../utils/friendship-utils.js';
import { calculateExpirationTime } from '../utils/invitation-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';
import { hasLimitOverride } from '../utils/profile-utils.js';

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Resends an invitation by resetting its created_at time and updating the expires_at time.
 *
 * Validates that:
 * 1. The user hasn't reached the combined limit of friends and active invitations (5)
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: The route parameters containing:
 *                - invitation_id: The ID of the invitation to resend
 *
 * @returns An ApiResponse containing the updated invitation and analytics
 *
 * @throws {400} User has reached the maximum number of friends and active invitations
 * @throws {403} You can only resend your own invitations
 * @throws {404} Invitation not found
 */
export const resendInvitation = async (
  req: Request,
): Promise<ApiResponse<Invitation>> => {
  const currentUserId = req.userId;
  const invitationId = req.params.invitation_id;
  logger.info(`User ${currentUserId} resending invitation ${invitationId}`);

  // Initialize Firestore client
  const db = getFirestore();

  if (!invitationId) {
    throw new BadRequestError('Invitation ID is required');
  }

  // Get the invitation document
  const invitationRef = db
    .collection(Collections.INVITATIONS)
    .doc(invitationId);
  const invitationDoc = await invitationRef.get();

  // Check if the invitation exists
  if (!invitationDoc.exists) {
    logger.warn(`Invitation ${invitationId} not found`);
    throw new NotFoundError('Invitation not found');
  }

  const invitationData = invitationDoc.data();

  // Check if the current user is the sender of the invitation
  const senderId = invitationData?.[InvitationFields.SENDER_ID];
  if (senderId !== currentUserId) {
    logger.warn(
      `User ${currentUserId} is not the sender of invitation ${invitationId}`,
    );
    throw new ForbiddenError('You can only resend your own invitations');
  }

  // Check combined limit (excluding the current invitation)
  const { friendCount, activeInvitationCount, hasReachedLimit } =
    await hasReachedCombinedLimit(currentUserId, invitationId);
  if (hasReachedLimit) {
    const override = await hasLimitOverride(currentUserId);
    if (!override) {
      logger.warn(
        `User ${currentUserId} has reached the maximum number of friends and active invitations`,
      );
      throw new BadRequestError(
        'You have reached the maximum number of friends and active invitations',
      );
    }
  }

  // Set new timestamps
  const currentTime = Timestamp.now();
  const expiresAt = calculateExpirationTime();

  // Update the invitation with new timestamps
  const updatePayload: UpdateData<DocumentData> = {
    [InvitationFields.CREATED_AT]: currentTime,
    [InvitationFields.EXPIRES_AT]: expiresAt,
    [InvitationFields.STATUS]: Status.PENDING,
  };
  await invitationRef.update(updatePayload);

  logger.info(`User ${currentUserId} resent invitation ${invitationId}`);

  // Return the updated invitation
  const invitation: Invitation = {
    invitation_id: invitationId,
    created_at: formatTimestamp(currentTime),
    expires_at: formatTimestamp(expiresAt),
    sender_id: currentUserId,
    status: Status.PENDING,
    username: invitationData?.[InvitationFields.USERNAME] || '',
    name: invitationData?.[InvitationFields.NAME] || '',
    avatar: invitationData?.[InvitationFields.AVATAR] || '',
    receiver_name: invitationData?.[InvitationFields.RECEIVER_NAME] || '',
  };

  // Create analytics event
  const event: InviteEventParams = {
    friend_count: friendCount,
    invitation_count: activeInvitationCount + 1, // Add 1 for the resent invitation
  };

  return {
    data: invitation,
    status: 200,
    analytics: {
      event: EventName.INVITE_RESENT,
      userId: currentUserId,
      params: event,
    },
  };
};
