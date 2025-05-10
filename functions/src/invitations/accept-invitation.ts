import { Request } from 'express';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { ApiResponse, EventName, InviteEventParams, } from '../models/analytics-events.js';
import {
  Collections,
  FriendPlaceholderTemplates,
  FriendshipFields,
  InvitationFields,
  ProfileFields,
  Status,
  UserSummaryFields,
} from '../models/constants.js';
import { Friend } from '../models/data-models.js';
import { BadRequestError, ForbiddenError } from '../utils/errors.js';
import { createFriendshipId, hasReachedCombinedLimit, } from '../utils/friendship-utils.js';
import {
  canActOnInvitation,
  getInvitationDoc,
  hasInvitationPermission,
  isInvitationExpired,
  updateInvitationStatus,
} from '../utils/invitation-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { createSummaryId, getProfileDoc, hasLimitOverride, } from '../utils/profile-utils.js';

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Accepts an invitation and creates a friendship between the users.
 *
 * This function:
 * 1. Checks if the invitation exists and is still valid
 * 2. Creates a new friendship document between the accepting user and the sender
 * 3. Deletes the invitation document
 *
 * Validates that:
 * 1. The accepting user hasn't reached the combined limit of friends and active invitations (5)
 * 2. The sender hasn't reached the combined limit of friends and active invitations (5)
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Route parameters containing:
 *                - invitation_id: The ID of the invitation to accept
 *
 * @returns An ApiResponse containing the new friend and analytics
 *
 * @throws 400: Invitation cannot be accepted (status: {status})
 * @throws 400: Invitation has expired
 * @throws 400: You cannot accept your own invitation
 * @throws 400: User has reached the maximum number of friends and active invitations
 * @throws 400: Sender has reached the maximum number of friends and active invitations
 * @throws 404: Invitation not found
 * @throws 404: User profile not found
 * @throws 404: Sender profile not found
 */
export const acceptInvitation = async (
  req: Request,
): Promise<ApiResponse<Friend>> => {
  const currentUserId = req.userId;
  const invitationId = req.params.invitation_id;

  logger.info(`User ${currentUserId} accepting invitation ${invitationId}`);

  // Initialize Firestore client
  const db = getFirestore();

  if (!invitationId) {
    throw new BadRequestError('Invitation ID is required');
  }

  // Get the invitation document
  const { ref: invitationRef, data: invitationData } =
    await getInvitationDoc(invitationId);

  // Check invitation status
  const status = invitationData[InvitationFields.STATUS];
  canActOnInvitation(status, 'accept');

  // Check if invitation has expired
  const expiresAt = invitationData[InvitationFields.EXPIRES_AT] as Timestamp;
  if (isInvitationExpired(expiresAt)) {
    // Update invitation status to expired
    await updateInvitationStatus(invitationRef, Status.EXPIRED);
    throw new ForbiddenError('Invitation has expired');
  }

  // Get the sender's user ID
  const senderId = invitationData[InvitationFields.SENDER_ID];

  // Ensure the current user is not the sender (can't accept your own invitation)
  hasInvitationPermission(senderId, currentUserId, 'accept');

  // Check combined limit for the accepting user
  const {
    friendCount: currentUserFriendCount,
    activeInvitationCount: currentUserInvitationCount,
    hasReachedLimit,
  } = await hasReachedCombinedLimit(currentUserId);
  if (hasReachedLimit) {
    const override = await hasLimitOverride(currentUserId);
    if (!override) {
      throw new BadRequestError(
        'You have reached the maximum number of friends and active invitations',
      );
    }
  }

  // Check combined limit for the sender (excluding this invitation)
  const { hasReachedLimit: senderHasReachedLimit } =
    await hasReachedCombinedLimit(senderId, invitationId);
  if (senderHasReachedLimit) {
    const override = await hasLimitOverride(senderId);
    if (!override) {
      throw new BadRequestError(
        'Sender has reached the maximum number of friends and active invitations',
      );
    }
  }

  // Get current user's profile
  const { data: currentUserProfile } = await getProfileDoc(currentUserId);

  // Get sender's profile
  const { data: senderProfile } = await getProfileDoc(senderId);

  // Create a batch operation for atomicity
  const batch = db.batch();

  // Create a consistent friendship ID by sorting the user IDs
  const friendshipId = createFriendshipId(currentUserId, senderId);

  // Check if friendship already exists
  const friendshipRef = db
    .collection(Collections.FRIENDSHIPS)
    .doc(friendshipId);
  const friendshipDoc = await friendshipRef.get();

  if (friendshipDoc.exists) {
    const friendshipData = friendshipDoc.data() || {};
    const friendshipStatus = friendshipData[FriendshipFields.STATUS];

    if (friendshipStatus === Status.ACCEPTED) {
      logger.warn(`Users ${currentUserId} and ${senderId} are already friends`);
      // Delete the invitation since they're already friends
      batch.delete(invitationRef);
      await batch.commit();

      // Return the existing friend using data from the friendship document
      let friendName: string;
      let friendUsername: string;
      let friendAvatar: string;

      if (friendshipData[FriendshipFields.SENDER_ID] === senderId) {
        friendName = friendshipData[FriendshipFields.SENDER_NAME] || '';
        friendUsername = friendshipData[FriendshipFields.SENDER_USERNAME] || '';
        friendAvatar = friendshipData[FriendshipFields.SENDER_AVATAR] || '';
      } else {
        friendName = friendshipData[FriendshipFields.RECEIVER_NAME] || '';
        friendUsername =
          friendshipData[FriendshipFields.RECEIVER_USERNAME] || '';
        friendAvatar = friendshipData[FriendshipFields.RECEIVER_AVATAR] || '';
      }

      const friend: Friend = {
        user_id: senderId,
        username: friendUsername,
        name: friendName,
        avatar: friendAvatar,
      };

      // Create analytics event
      const event: InviteEventParams = {
        friend_count: currentUserFriendCount,
        invitation_count: currentUserInvitationCount,
      };

      return {
        data: friend,
        status: 200,
        analytics: {
          event: EventName.INVITE_ACCEPTED,
          userId: currentUserId,
          params: event,
        },
      };
    }
  }

  // Create the friendship document using profile data directly
  const currentTime = Timestamp.now();
  const friendshipData = {
    [FriendshipFields.SENDER_ID]: senderId,
    [FriendshipFields.SENDER_NAME]: senderProfile[ProfileFields.NAME] || '',
    [FriendshipFields.SENDER_USERNAME]:
      senderProfile[ProfileFields.USERNAME] || '',
    [FriendshipFields.SENDER_AVATAR]: senderProfile[ProfileFields.AVATAR] || '',
    [FriendshipFields.RECEIVER_ID]: currentUserId,
    [FriendshipFields.RECEIVER_NAME]:
      currentUserProfile[ProfileFields.NAME] || '',
    [FriendshipFields.RECEIVER_USERNAME]:
      currentUserProfile[ProfileFields.USERNAME] || '',
    [FriendshipFields.RECEIVER_AVATAR]:
      currentUserProfile[ProfileFields.AVATAR] || '',
    [FriendshipFields.STATUS]: Status.ACCEPTED,
    [FriendshipFields.CREATED_AT]: currentTime,
    [FriendshipFields.UPDATED_AT]: currentTime,
    [FriendshipFields.MEMBERS]: [senderId, currentUserId],
  };

  // Add operations to batch
  batch.set(friendshipRef, friendshipData);
  batch.delete(invitationRef);

  const senderName =
    senderProfile[ProfileFields.NAME] ||
    senderProfile[ProfileFields.USERNAME] ||
    'Friend';
  const currentUserName =
    currentUserProfile[ProfileFields.NAME] ||
    currentUserProfile[ProfileFields.USERNAME] ||
    'Friend';

  // Create summary for current user about sender
  const summaryIdForCurrentUser = createSummaryId(currentUserId, senderId);
  const summaryRefForCurrentUser = db
    .collection(Collections.USER_SUMMARIES)
    .doc(summaryIdForCurrentUser);
  const summaryDataForCurrentUser = {
    [UserSummaryFields.CREATOR_ID]: senderId,
    [UserSummaryFields.TARGET_ID]: currentUserId,
    [UserSummaryFields.SUMMARY]: FriendPlaceholderTemplates.SUMMARY.replace(
      '<FRIEND_NAME>',
      senderName,
    ),
    [UserSummaryFields.SUGGESTIONS]:
      FriendPlaceholderTemplates.SUGGESTIONS.replace(
        '<FRIEND_NAME>',
        senderName,
      ),
    [UserSummaryFields.LAST_UPDATE_ID]: '',
    [UserSummaryFields.UPDATE_COUNT]: 0,
    [UserSummaryFields.CREATED_AT]: currentTime,
    [UserSummaryFields.UPDATED_AT]: currentTime,
  };
  batch.set(summaryRefForCurrentUser, summaryDataForCurrentUser);

  // Create summary for sender about current user
  const summaryIdForSender = createSummaryId(senderId, currentUserId);
  const summaryRefForSender = db
    .collection(Collections.USER_SUMMARIES)
    .doc(summaryIdForSender);
  const summaryDataForSender = {
    [UserSummaryFields.CREATOR_ID]: currentUserId,
    [UserSummaryFields.TARGET_ID]: senderId,
    [UserSummaryFields.SUMMARY]: FriendPlaceholderTemplates.SUMMARY.replace(
      '<FRIEND_NAME>',
      currentUserName,
    ),
    [UserSummaryFields.SUGGESTIONS]:
      FriendPlaceholderTemplates.SUGGESTIONS.replace(
        '<FRIEND_NAME>',
        currentUserName,
      ),
    [UserSummaryFields.LAST_UPDATE_ID]: '',
    [UserSummaryFields.UPDATE_COUNT]: 0,
    [UserSummaryFields.CREATED_AT]: currentTime,
    [UserSummaryFields.UPDATED_AT]: currentTime,
  };
  batch.set(summaryRefForSender, summaryDataForSender);

  // Commit the batch
  await batch.commit();

  logger.info(
    `User ${currentUserId} accepted invitation ${invitationId} from ${senderId}`,
  );

  // Return the friend object using sender's profile data
  const friend: Friend = {
    user_id: senderId,
    username: senderProfile[ProfileFields.USERNAME] || '',
    name: senderProfile[ProfileFields.NAME] || '',
    avatar: senderProfile[ProfileFields.AVATAR] || '',
  };

  // Create analytics event
  const event: InviteEventParams = {
    friend_count: currentUserFriendCount + 1, // Add 1 for the new friend
    invitation_count: currentUserInvitationCount,
  };

  return {
    data: friend,
    status: 200,
    analytics: {
      event: EventName.INVITE_ACCEPTED,
      userId: currentUserId,
      params: event,
    },
  };
};
