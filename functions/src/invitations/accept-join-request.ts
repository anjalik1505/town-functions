import { Request } from 'express';
import { DocumentData, getFirestore, Timestamp, UpdateData } from 'firebase-admin/firestore';
import { ApiResponse, EventName, InviteEventParams } from '../models/analytics-events.js';
import {
  Collections,
  FriendPlaceholderTemplates,
  FriendshipFields,
  JoinRequestFields,
  ProfileFields,
  Status,
  UserSummaryFields,
} from '../models/constants.js';
import { Friend } from '../models/data-models.js';
import { BadRequestError } from '../utils/errors.js';
import { getFriendshipRefAndDoc } from '../utils/friendship-utils.js';
import {
  getInvitationDocForUser,
  getJoinRequestDoc,
  hasReachedCombinedLimitOrOverride,
  validateJoinRequestOwnership,
} from '../utils/invitation-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { createSummaryId, getProfileDoc } from '../utils/profile-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Accepts a join request and creates a friendship between the users.
 *
 * This function:
 * 1. Validates the join request exists and the current user is the invitation owner
 * 2. Updates the join request status to accepted
 * 3. Creates friendship entries for both users
 * 4. Returns the new friend data
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Request parameters containing:
 *                - request_id: The ID of the request
 *
 * @returns An ApiResponse containing the new friend and analytics
 *
 * @throws 400: Join request is already accepted/rejected
 * @throws 403: You are not authorized to accept this join request
 * @throws 404: Join request not found
 * @throws 404: User profile not found (if requester or current user profile doesn't exist)
 */
export const acceptJoinRequest = async (req: Request): Promise<ApiResponse<Friend>> => {
  // Get validated params
  const currentUserId = req.userId;
  const requestId = req.params.request_id as string;

  logger.info(`User ${currentUserId} accepting join request ${requestId}`);

  const { ref: invitationRef } = await getInvitationDocForUser(currentUserId);
  const invitationId = invitationRef.id;

  // Get the join request from the subcollection
  const { ref: requestRef, data: requestData } = await getJoinRequestDoc(invitationId, requestId);
  const requesterId = requestData[JoinRequestFields.REQUESTER_ID] as string;
  const receiverId = requestData[JoinRequestFields.RECEIVER_ID] as string;
  const currentStatus = requestData[JoinRequestFields.STATUS] as string;

  // Validate that the current user is the recipient of the request
  validateJoinRequestOwnership(receiverId, currentUserId);

  const { friendCount } = await hasReachedCombinedLimitOrOverride(currentUserId, requesterId);

  // Check if the request is already accepted or rejected
  if (currentStatus !== Status.PENDING) {
    logger.warn(`Join request from ${requesterId} is already ${currentStatus}`);
    throw new BadRequestError(`Join request is already ${currentStatus}`);
  }

  const db = getFirestore();
  const batch = db.batch();

  // Update the join request status to accepted
  batch.delete(requestRef);

  // Get current user's profile
  const { data: currentUserProfile } = await getProfileDoc(currentUserId);

  // Get sender's profile
  const { data: senderProfile } = await getProfileDoc(requesterId);

  // Check if friendship already exists
  const {
    id: friendshipId,
    ref: friendshipRef,
    doc: friendshipDoc,
  } = await getFriendshipRefAndDoc(currentUserId, requesterId);

  if (friendshipDoc.exists) {
    const friendshipData = friendshipDoc.data() || {};

    logger.warn(`Users ${currentUserId} and ${requesterId} are already friends`);
    // Delete the invitation since they're already friends
    await batch.commit();

    // Return the existing friend using data from the friendship document
    let friendName: string;
    let friendUsername: string;
    let friendAvatar: string;
    let lastUpdateEmoji: string;

    if (friendshipData[FriendshipFields.SENDER_ID] === requesterId) {
      friendName = friendshipData[FriendshipFields.SENDER_NAME] || '';
      friendUsername = friendshipData[FriendshipFields.SENDER_USERNAME] || '';
      friendAvatar = friendshipData[FriendshipFields.SENDER_AVATAR] || '';
      lastUpdateEmoji = friendshipData[FriendshipFields.SENDER_LAST_UPDATE_EMOJI] || '';
    } else {
      friendName = friendshipData[FriendshipFields.RECEIVER_NAME] || '';
      friendUsername = friendshipData[FriendshipFields.RECEIVER_USERNAME] || '';
      friendAvatar = friendshipData[FriendshipFields.RECEIVER_AVATAR] || '';
      lastUpdateEmoji = friendshipData[FriendshipFields.RECEIVER_LAST_UPDATE_EMOJI] || '';
    }

    const friend: Friend = {
      user_id: requesterId,
      username: friendUsername,
      name: friendName,
      avatar: friendAvatar,
      last_update_emoji: lastUpdateEmoji,
    };

    // Create analytics event
    const event: InviteEventParams = {
      friend_count: friendCount,
    };

    return {
      data: friend,
      status: 200,
      analytics: {
        event: EventName.JOIN_ACCEPTED,
        userId: currentUserId,
        params: event,
      },
    };
  }

  // Create the friendship document using profile data directly
  const currentTime = Timestamp.now();
  const friendshipData: UpdateData<DocumentData> = {
    [FriendshipFields.SENDER_ID]: requesterId,
    [FriendshipFields.SENDER_NAME]: senderProfile[ProfileFields.NAME] || '',
    [FriendshipFields.SENDER_USERNAME]: senderProfile[ProfileFields.USERNAME] || '',
    [FriendshipFields.SENDER_AVATAR]: senderProfile[ProfileFields.AVATAR] || '',
    [FriendshipFields.RECEIVER_ID]: currentUserId,
    [FriendshipFields.RECEIVER_NAME]: currentUserProfile[ProfileFields.NAME] || '',
    [FriendshipFields.RECEIVER_USERNAME]: currentUserProfile[ProfileFields.USERNAME] || '',
    [FriendshipFields.RECEIVER_AVATAR]: currentUserProfile[ProfileFields.AVATAR] || '',
    [FriendshipFields.CREATED_AT]: currentTime,
    [FriendshipFields.UPDATED_AT]: currentTime,
    [FriendshipFields.MEMBERS]: [requesterId, currentUserId],
  };

  // Add operations to batch
  batch.set(friendshipRef, friendshipData);

  const senderName = senderProfile[ProfileFields.NAME] || senderProfile[ProfileFields.USERNAME] || 'Friend';
  const currentUserName =
    currentUserProfile[ProfileFields.NAME] || currentUserProfile[ProfileFields.USERNAME] || 'Friend';

  // Create summary for current user about sender
  const summaryIdForCurrentUser = createSummaryId(currentUserId, requesterId);
  const summaryRefForCurrentUser = db.collection(Collections.USER_SUMMARIES).doc(summaryIdForCurrentUser);
  const summaryDataForCurrentUser: UpdateData<DocumentData> = {
    [UserSummaryFields.CREATOR_ID]: requesterId,
    [UserSummaryFields.TARGET_ID]: currentUserId,
    [UserSummaryFields.SUMMARY]: FriendPlaceholderTemplates.SUMMARY.replace('<FRIEND_NAME>', senderName),
    [UserSummaryFields.SUGGESTIONS]: FriendPlaceholderTemplates.SUGGESTIONS.replace('<FRIEND_NAME>', senderName),
    [UserSummaryFields.LAST_UPDATE_ID]: '',
    [UserSummaryFields.UPDATE_COUNT]: 0,
    [UserSummaryFields.CREATED_AT]: currentTime,
    [UserSummaryFields.UPDATED_AT]: currentTime,
  };
  batch.set(summaryRefForCurrentUser, summaryDataForCurrentUser);

  // Create a summary for sender about the current user
  const summaryIdForSender = createSummaryId(requesterId, currentUserId);
  const summaryRefForSender = db.collection(Collections.USER_SUMMARIES).doc(summaryIdForSender);
  const summaryDataForSender: UpdateData<DocumentData> = {
    [UserSummaryFields.CREATOR_ID]: currentUserId,
    [UserSummaryFields.TARGET_ID]: requesterId,
    [UserSummaryFields.SUMMARY]: FriendPlaceholderTemplates.SUMMARY.replace('<FRIEND_NAME>', currentUserName),
    [UserSummaryFields.SUGGESTIONS]: FriendPlaceholderTemplates.SUGGESTIONS.replace('<FRIEND_NAME>', currentUserName),
    [UserSummaryFields.LAST_UPDATE_ID]: '',
    [UserSummaryFields.UPDATE_COUNT]: 0,
    [UserSummaryFields.CREATED_AT]: currentTime,
    [UserSummaryFields.UPDATED_AT]: currentTime,
  };
  batch.set(summaryRefForSender, summaryDataForSender);

  // Commit the batch
  await batch.commit();
  logger.info(`Accepted join request from ${requesterId} and created friendship ${friendshipId}`);

  // Return the friend object using sender's profile data
  const friend: Friend = {
    user_id: requesterId,
    username: senderProfile[ProfileFields.USERNAME] || '',
    name: senderProfile[ProfileFields.NAME] || '',
    avatar: senderProfile[ProfileFields.AVATAR] || '',
    last_update_emoji: '',
  };

  // Create analytics event
  const event: InviteEventParams = {
    friend_count: friendCount,
  };

  return {
    data: friend,
    status: 200,
    analytics: {
      event: EventName.JOIN_ACCEPTED,
      userId: currentUserId,
      params: event,
    },
  };
};
