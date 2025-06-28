import { Request } from 'express';
import { Timestamp } from 'firebase-admin/firestore';
import { ApiResponse, EventName, InviteEventParams } from '../models/analytics-events.js';
import { Collections, QueryOperators } from '../models/constants.js';
import { JoinRequestDoc, JoinRequestStatus, joinRequestConverter, jrf } from '../models/firestore/join-request-doc.js';
import { JoinRequest } from '../models/data-models.js';
import { areFriends, hasReachedCombinedLimit } from '../utils/friendship-utils.js';
import {
  formatJoinRequest,
  getInvitationDoc,
  hasInvitationPermission,
  hasReachedCombinedLimitOrOverride,
} from '../utils/invitation-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { getProfileDoc } from '../utils/profile-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';
import { ConflictError } from '../utils/errors.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Creates a join request for an invitation.
 *
 * This function:
 * 1. Validates the invitation exists and the user can request to join
 * 2. Checks if the user already has a pending join request for this invitation
 * 3. Creates a new join request if one doesn't exist
 * 4. Returns the join request data
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Request parameters containing:
 *                - invitation_id: The ID of the invitation to join
 *
 * @returns An ApiResponse containing the join request and analytics
 *
 * @throws 400: You cannot join your own invitation
 * @throws 400: User has reached the maximum number of friends and active invitations
 * @throws 400: Sender has reached the maximum number of friends and active invitations
 * @throws 404: Invitation not found
 * @throws 404: User profile not found
 * @throws 404: Sender profile not found
 * @throws 409: You are already friends with this user
 * @throws 409: Your previous join request was rejected. You cannot request to join again.
 */
export const requestToJoin = async (req: Request): Promise<ApiResponse<JoinRequest>> => {
  // Get validated params
  const currentUserId = req.userId;
  const invitationId = req.params.invitation_id as string;

  logger.info(`User ${currentUserId} requesting to join via invitation ${invitationId}`);

  // Get the invitation
  const { ref: invitationRef, data: invitationData } = await getInvitationDoc(invitationId);
  const receiverId = invitationData.sender_id as string;

  // Check if the user is trying to join their own invitation
  hasInvitationPermission(receiverId, currentUserId, 'join');

  // Check if friendship already exists
  const areFriendsResult = await areFriends(currentUserId, receiverId);

  if (areFriendsResult) {
    throw new ConflictError('You are already friends with this user');
  }

  const { friendCount } = await hasReachedCombinedLimitOrOverride(currentUserId, receiverId);

  // Check if the user already has a pending join request for this invitation
  // Now using the subcollection approach

  const joinRequestsCollection = invitationRef
    .collection(Collections.JOIN_REQUESTS)
    .withConverter(joinRequestConverter);
  const existingRequests = await joinRequestsCollection
    .where(jrf('requester_id'), QueryOperators.EQUALS, currentUserId)
    .where(jrf('status'), QueryOperators.IN, [JoinRequestStatus.PENDING, JoinRequestStatus.REJECTED])
    .limit(1)
    .get();

  if (!existingRequests.empty) {
    const existingRequest = existingRequests.docs[0];
    const requestData = existingRequest?.data();
    if (!requestData) {
      throw new Error('No request data found');
    }
    const status = requestData.status;

    if (status === JoinRequestStatus.PENDING) {
      logger.info(`User ${currentUserId} already has a pending join request for invitation ${invitationId}`);
    } else if (status === JoinRequestStatus.REJECTED) {
      logger.info(`User ${currentUserId} has a rejected join request for invitation ${invitationId}`);
      throw new ConflictError('Your previous join request was rejected. You cannot request to join again.');
    }

    // Get current friend count for analytics
    const { friendCount } = await hasReachedCombinedLimit(currentUserId);

    // Create analytics event
    const event: InviteEventParams = {
      friend_count: friendCount,
    };

    return {
      data: formatJoinRequest(existingRequest?.id || '', requestData),
      status: 200,
      analytics: {
        event: EventName.JOIN_REQUESTED,
        userId: currentUserId,
        params: event,
      },
    };
  }

  // Get requester's profile data
  const { data: profileData } = await getProfileDoc(currentUserId);

  // Create a new join request in the subcollection
  const requestRef = joinRequestsCollection.doc();
  const currentTime = Timestamp.now();

  const requestData: JoinRequestDoc = {
    request_id: requestRef.id,
    invitation_id: invitationId,
    requester_id: currentUserId,
    receiver_id: receiverId,
    status: JoinRequestStatus.PENDING,
    created_at: currentTime,
    updated_at: currentTime,
    requester_name: profileData.name || '',
    requester_username: profileData.username || '',
    requester_avatar: profileData.avatar || '',
    receiver_name: invitationData.name || '',
    receiver_username: invitationData.username || '',
    receiver_avatar: invitationData.avatar || '',
  };

  await requestRef.set(requestData);
  logger.info(`Created join request ${requestRef.id} for invitation ${invitationId}`);

  // Create analytics event
  const event: InviteEventParams = {
    friend_count: friendCount,
  };

  return {
    data: formatJoinRequest(requestRef.id, requestData),
    status: 201,
    analytics: {
      event: EventName.JOIN_REQUESTED,
      userId: currentUserId,
      params: event,
    },
  };
};
