import { Request } from 'express';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import {
  ApiResponse,
  EventName,
  InviteEventParams,
} from '../models/analytics-events.js';
import {
  Collections,
  InvitationFields,
  ProfileFields,
  Status,
} from '../models/constants.js';
import { Invitation } from '../models/data-models.js';
import { BadRequestError } from '../utils/errors.js';
import { hasReachedCombinedLimit } from '../utils/friendship-utils.js';
import { formatInvitation } from '../utils/invitation-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { getProfileDoc, hasLimitOverride } from '../utils/profile-utils.js';

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Creates a new invitation from the current user.
 *
 * This function creates a new invitation document in the invitations collection.
 * The invitation will have a pending status and will expire after 1 day.
 *
 * Validates that:
 * 1. The user hasn't reached the combined limit of friends and active invitations (5)
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: The validated request body containing:
 *                - receiver_name: The name of the person being invited
 *
 * @returns An ApiResponse containing the invitation and analytics
 *
 * @throws 400: User has reached the maximum number of friends and active invitations
 * @throws 404: User profile not found
 */
export const createInvitation = async (
  req: Request,
): Promise<ApiResponse<Invitation>> => {
  const currentUserId = req.userId;
  logger.info(`Creating invitation for user ${currentUserId}`);

  // Check combined limit
  const { friendCount, activeInvitationCount, hasReachedLimit } =
    await hasReachedCombinedLimit(currentUserId);
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

  // Initialize Firestore client
  const db = getFirestore();

  // Get current user's profile for name and avatar
  const { data: currentUserProfile } = await getProfileDoc(currentUserId);

  const validatedParams = req.validated_params;

  // Create a new invitation document
  const invitationRef = db.collection(Collections.INVITATIONS).doc();

  // Set expiration time (1 day from now)
  const currentTime = Timestamp.now();
  const expiresAt = new Timestamp(
    currentTime.seconds + 24 * 60 * 60, // Add 24 hours in seconds
    currentTime.nanoseconds,
  );

  // Create invitation data
  const invitationData = {
    [InvitationFields.SENDER_ID]: currentUserId,
    [InvitationFields.USERNAME]:
      currentUserProfile[ProfileFields.USERNAME] || '',
    [InvitationFields.NAME]: currentUserProfile[ProfileFields.NAME] || '',
    [InvitationFields.AVATAR]: currentUserProfile[ProfileFields.AVATAR] || '',
    [InvitationFields.STATUS]: Status.PENDING,
    [InvitationFields.CREATED_AT]: currentTime,
    [InvitationFields.EXPIRES_AT]: expiresAt,
    [InvitationFields.RECEIVER_NAME]: validatedParams.receiver_name,
  };

  // Set the invitation document
  await invitationRef.set(invitationData);

  logger.info(`Created invitation with ID ${invitationRef.id}`);

  // Return the invitation object
  const invitation = formatInvitation(invitationRef.id, invitationData);

  // Create analytics event
  const event: InviteEventParams = {
    friend_count: friendCount,
    invitation_count: activeInvitationCount + 1, // Add 1 for the new invitation
  };

  return {
    data: invitation,
    status: 201,
    analytics: {
      event: EventName.INVITE_CREATED,
      userId: currentUserId,
      params: event,
    },
  };
};
