import { Request } from 'express';
import { DocumentData, getFirestore, Timestamp, UpdateData } from 'firebase-admin/firestore';
import { ApiResponse, EventName, InviteEventParams } from '../models/analytics-events.js';
import { Collections, JoinRequestFields, QueryOperators, Status } from '../models/constants.js';
import { JoinRequest } from '../models/data-models.js';
import { createFriendshipId, hasReachedCombinedLimit } from '../utils/friendship-utils.js';
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

  // Create a consistent friendship ID by sorting the user IDs
  const friendshipId = createFriendshipId(currentUserId, receiverId);

  // Initialize Firestore client
  const db = getFirestore();

  // Check if friendship already exists
  const friendshipRef = db.collection(Collections.FRIENDSHIPS).doc(friendshipId);
  const friendshipDoc = await friendshipRef.get();

  if (friendshipDoc.exists) {
    throw new ConflictError('You are already friends with this user');
  }

  const { friendCount } = await hasReachedCombinedLimitOrOverride(currentUserId, receiverId);

  // Check if the user already has a pending join request for this invitation
  // Now using the subcollection approach

  const joinRequestsCollection = invitationRef.collection(Collections.JOIN_REQUESTS);
  const existingRequests = await joinRequestsCollection
    .where(JoinRequestFields.REQUESTER_ID, QueryOperators.EQUALS, currentUserId)
    .where(JoinRequestFields.STATUS, QueryOperators.EQUALS, Status.PENDING)
    .limit(1)
    .get();

  if (!existingRequests.empty) {
    logger.info(`User ${currentUserId} already has a pending join request for invitation ${invitationId}`);
    const existingRequest = existingRequests.docs[0];
    const requestData = existingRequest?.data() || {};

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
  // Use the requester's ID as the document ID for easy lookup
  const requestRef = joinRequestsCollection.doc(currentUserId);
  const currentTime = Timestamp.now();

  const requestData: UpdateData<DocumentData> = {
    [JoinRequestFields.REQUEST_ID]: requestRef.id,
    [JoinRequestFields.INVITATION_ID]: invitationId,
    [JoinRequestFields.REQUESTER_ID]: currentUserId,
    [JoinRequestFields.RECEIVER_ID]: receiverId,
    [JoinRequestFields.STATUS]: Status.PENDING,
    [JoinRequestFields.CREATED_AT]: currentTime,
    [JoinRequestFields.UPDATED_AT]: currentTime,
    [JoinRequestFields.REQUESTER_NAME]: profileData.name || '',
    [JoinRequestFields.REQUESTER_USERNAME]: profileData.username || '',
    [JoinRequestFields.REQUESTER_AVATAR]: profileData.avatar || '',
    [JoinRequestFields.RECEIVER_NAME]: invitationData.name || '',
    [JoinRequestFields.RECEIVER_USERNAME]: invitationData.username || '',
    [JoinRequestFields.RECEIVER_AVATAR]: invitationData.avatar || '',
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
