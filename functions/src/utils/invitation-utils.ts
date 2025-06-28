import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { Collections, QueryOperators } from '../models/constants.js';
import { Invitation, JoinRequest } from '../models/data-models.js';
import { InvitationDoc, invitationConverter, if_ } from '../models/firestore/invitation-doc.js';
import { JoinRequestDoc, joinRequestConverter, jrf } from '../models/firestore/join-request-doc.js';
import { BadRequestError, ForbiddenError, NotFoundError } from './errors.js';
import { getLogger } from './logging-utils.js';
import { formatTimestamp } from './timestamp-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';
import { hasReachedCombinedLimit } from './friendship-utils.js';
import { hasLimitOverride } from './profile-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Gets an invitation document by ID
 * @param userId The ID of the user
 * @returns The invitation document and data
 * @throws NotFoundError if the invitation doesn't exist
 */
export const getInvitationDocForUser = async (userId: string) => {
  const existingInvitation = await getUserInvitationLink(userId);

  if (!existingInvitation) {
    logger.warn(`Invitation for ${userId} not found`);
    throw new NotFoundError(`Invitation not found`);
  }

  return {
    ref: existingInvitation.ref,
    doc: existingInvitation.doc,
    data: existingInvitation.data,
  };
};

/**
 * Gets an invitation document by ID
 * @param invitationId The ID of the invitation to retrieve
 * @returns The invitation document and data
 * @throws NotFoundError if the invitation doesn't exist
 */
export const getInvitationDoc = async (invitationId: string) => {
  const db = getFirestore();
  const invitationRef = db.collection(Collections.INVITATIONS).withConverter(invitationConverter).doc(invitationId);
  const invitationDoc = await invitationRef.get();

  if (!invitationDoc.exists) {
    logger.warn(`Invitation ${invitationId} not found`);
    throw new NotFoundError(`Invitation not found`);
  }

  return {
    ref: invitationRef,
    doc: invitationDoc,
    data: invitationDoc.data() as InvitationDoc,
  };
};

/**
 * Gets the current invitation link for a user
 * @param userId The ID of the user
 * @returns The invitation document reference and data, or null if no invitation exists
 */
export const getUserInvitationLink = async (userId: string) => {
  const db = getFirestore();

  // Query invitations where sender_id matches the user ID
  const invitationSnapshot = await db
    .collection(Collections.INVITATIONS)
    .withConverter(invitationConverter)
    .where(if_('sender_id'), QueryOperators.EQUALS, userId)
    .limit(1)
    .get();

  if (!invitationSnapshot.empty) {
    const invitationDoc = invitationSnapshot.docs[0];

    if (invitationDoc && invitationDoc.exists) {
      return {
        ref: invitationDoc.ref,
        doc: invitationDoc,
        data: invitationDoc.data() as InvitationDoc,
        isNew: false,
      };
    }
  }

  return null;
};

/**
 * Gets or creates an invitation link for a user
 * @param userId The ID of the user
 * @param profileData User profile data containing name, username, and avatar
 * @returns The invitation document reference and data
 * @throws FirebaseError if there's an issue with Firestore operations
 */
export const getOrCreateInvitationLink = async (
  userId: string,
  profileData: { name?: string; username?: string; avatar?: string },
) => {
  // Check if user already has an invitation
  const existingInvitation = await getUserInvitationLink(userId);

  if (existingInvitation) {
    return existingInvitation;
  }

  // Create a new invitation link with a random ID
  const db = getFirestore();
  const invitationRef = db.collection(Collections.INVITATIONS).withConverter(invitationConverter).doc();
  const currentTime = Timestamp.now();

  const invitationData: InvitationDoc = {
    sender_id: userId,
    username: profileData.username || '',
    name: profileData.name || '',
    avatar: profileData.avatar || '',
    created_at: currentTime,
  };

  await invitationRef.set(invitationData);
  logger.info(`Created invitation link with ID ${invitationRef.id} for user ${userId}`);

  return {
    ref: invitationRef,
    data: invitationData,
    isNew: true,
  };
};

/**
 * Gets a join request document by ID
 * @param invitationId The ID of the invitation containing the join request
 * @param requestId The ID of the user who made the request
 * @returns The join request document and data
 * @throws NotFoundError if the join request doesn't exist
 * @throws NotFoundError if the invitation doesn't exist
 */
export const getJoinRequestDoc = async (invitationId: string, requestId: string) => {
  const db = getFirestore();
  const invitationRef = db.collection(Collections.INVITATIONS).doc(invitationId);

  // Now get the join request from the subcollection
  const requestRef = invitationRef
    .collection(Collections.JOIN_REQUESTS)
    .withConverter(joinRequestConverter)
    .doc(requestId);
  const requestDoc = await requestRef.get();

  if (!requestDoc.exists) {
    logger.warn(`Join request for user ${requestId} in invitation ${invitationId} not found`);
    throw new NotFoundError('Join request not found');
  }

  return {
    ref: requestRef,
    doc: requestDoc,
    data: requestDoc.data() as JoinRequestDoc,
  };
};

/**
 * Validates that the current user is the owner of the invitation for a join request
 * @param receiverId The ID of the invitation owner
 * @param currentUserId The ID of the current user
 * @throws ForbiddenError if the current user is not the invitation owner
 */
export const validateJoinRequestOwnership = (receiverId: string, currentUserId: string): void => {
  if (receiverId !== currentUserId) {
    logger.warn(`User ${currentUserId} attempted to act on a join request for invitation owned by ${receiverId}`);
    throw new ForbiddenError(`You can only act on join requests for your own invitations`);
  }
};

/**
 * Formats a join request document into a JoinRequest object
 * @param requestId The ID of the join request
 * @param requestData The join request data
 * @returns A formatted JoinRequest object
 */
export const formatJoinRequest = (requestId: string, requestData: JoinRequestDoc): JoinRequest => {
  return {
    request_id: requestId,
    invitation_id: requestData.invitation_id,
    requester_id: requestData.requester_id,
    receiver_id: requestData.receiver_id,
    status: requestData.status,
    created_at: formatTimestamp(requestData.created_at),
    updated_at: formatTimestamp(requestData.updated_at),
    requester_name: requestData.requester_name,
    requester_username: requestData.requester_username,
    requester_avatar: requestData.requester_avatar,
    receiver_name: requestData.receiver_name,
    receiver_username: requestData.receiver_username,
    receiver_avatar: requestData.receiver_avatar,
  };
};

/**
 * Gets all join requests for an invitation
 * @param invitationId The ID of the invitation
 * @returns Array of join requests
 */
export const getJoinRequestsForInvitation = async (invitationId: string): Promise<JoinRequest[]> => {
  const db = getFirestore();

  // Get the invitation document reference
  const invitationRef = db.collection(Collections.INVITATIONS).doc(invitationId);

  // Query the join requests subcollection
  const requestsSnapshot = await invitationRef
    .collection(Collections.JOIN_REQUESTS)
    .withConverter(joinRequestConverter)
    .orderBy(jrf('created_at'), 'desc')
    .get();

  const joinRequests: JoinRequest[] = [];

  requestsSnapshot.forEach((doc) => {
    const requestData = doc.data();
    if (requestData) {
      joinRequests.push(formatJoinRequest(doc.id, requestData));
    }
  });

  return joinRequests;
};

/**
 * Formats an invitation document into an Invitation object
 * @param invitationId The ID of the invitation
 * @param invitationData The invitation data
 * @returns A formatted Invitation object
 */
export const formatInvitation = (invitationId: string, invitationData: InvitationDoc): Invitation => {
  const createdAt = invitationData.created_at;

  return {
    invitation_id: invitationId,
    created_at: formatTimestamp(createdAt),
    sender_id: invitationData.sender_id || '',
    username: invitationData.username || '',
    name: invitationData.name || '',
    avatar: invitationData.avatar || '',
  };
};

/**
 * Checks if a user has permission to act on an invitation
 * @param senderId The ID of the user who sent the invitation
 * @param currentUserId The ID of the current user
 * @param action The action being performed (e.g., "view", "accept", "reject")
 * @throws BadRequestError if the user is trying to act on their own invitation
 */
export const hasInvitationPermission = (senderId: string, currentUserId: string, action: string): void => {
  if (senderId === currentUserId) {
    logger.warn(`User ${currentUserId} attempted to ${action} their own invitation`);
    throw new BadRequestError(`You cannot ${action} your own invitation`);
  }
};

/**
 * Checks if a user has reached the combined limit of friends and active invitations, or if they have a limit override.
 * @param currentUserId The ID of the user to check
 * @param senderId The ID of the sender user to check
 * @returns An object containing the friend count and whether the limit has been reached
 * @throws BadRequestError If the user has reached the limit and does not have an override
 * @throws BadRequestError If the sender has reached the limit and does not have an override
 */
export const hasReachedCombinedLimitOrOverride = async (
  currentUserId: string,
  senderId: string,
): Promise<{
  friendCount: number;
}> => {
  const { friendCount, hasReachedLimit } = await hasReachedCombinedLimit(currentUserId);
  if (hasReachedLimit) {
    const override = await hasLimitOverride(currentUserId);
    if (!override) {
      throw new BadRequestError('You have reached the maximum number of friends and active invitations');
    }
  }

  // Check the combined limit for the sender (excluding this invitation)
  const { hasReachedLimit: senderHasReachedLimit } = await hasReachedCombinedLimit(senderId);
  if (senderHasReachedLimit) {
    const override = await hasLimitOverride(senderId);
    if (!override) {
      throw new BadRequestError('Sender has reached the maximum number of friends and active invitations');
    }
  }

  return { friendCount };
};

/**
 * Delete all invitations sent by or received by the user.
 *
 * @param userId - The ID of the user whose profile was deleted
 * @returns The number of invitations deleted
 */
export const deleteInvitation = async (userId: string): Promise<number> => {
  const db = getFirestore();
  const existingInvitation = await getUserInvitationLink(userId);

  let joinRequestsDeleted = 0;

  // Delete the invitation and all its subcollections if it exists
  if (existingInvitation) {
    const invitationRef = existingInvitation.ref;
    logger.info(
      `Found existing invitation with ID ${invitationRef.id} for user ${userId}, deleting it and all join requests`,
    );

    try {
      // Count the number of join requests first for analytics
      const joinRequestsSnapshot = await invitationRef.collection(Collections.JOIN_REQUESTS).count().get();
      joinRequestsDeleted = joinRequestsSnapshot.data().count;
    } catch (error) {
      logger.error(`Error counting join requests: ${error}`);
    }

    // Use recursiveDelete to delete the invitation document and all its subcollections
    await db.recursiveDelete(invitationRef);
    logger.info(
      `Deleted invitation with ID ${invitationRef.id} for user ${userId} and ${joinRequestsDeleted} join requests`,
    );
  }
  return joinRequestsDeleted;
};
