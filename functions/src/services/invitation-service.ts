import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { FriendshipDAO } from '../dao/friendship-dao.js';
import { InvitationDAO } from '../dao/invitation-dao.js';
import { JoinRequestDAO } from '../dao/join-request-dao.js';
import { ProfileDAO } from '../dao/profile-dao.js';
import { ApiResponse, EventName } from '../models/analytics-events.js';
import { Friend, Invitation, JoinRequest, JoinRequestResponse } from '../models/data-models.js';
import { JoinRequestDoc, JoinRequestStatus } from '../models/firestore/join-request-doc.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Service layer for Invitation-related operations
 * Coordinates between InvitationDAO, JoinRequestDAO, ProfileDAO, and FriendshipDAO
 */
export class InvitationService {
  private invitationDAO: InvitationDAO;
  private joinRequestDAO: JoinRequestDAO;
  private profileDAO: ProfileDAO;
  private friendshipDAO: FriendshipDAO;

  constructor() {
    this.invitationDAO = new InvitationDAO();
    this.joinRequestDAO = new JoinRequestDAO();
    this.profileDAO = new ProfileDAO();
    this.friendshipDAO = new FriendshipDAO();
  }

  /**
   * Gets or creates an invitation for a user
   */
  async getInvitation(userId: string): Promise<ApiResponse<Invitation>> {
    logger.info(`Getting invitation for user ${userId}`);

    const profile = await this.profileDAO.getById(userId);
    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    const invitation = await this.invitationDAO.createOrGet(userId, {
      username: profile.username,
      name: profile.name,
      avatar: profile.avatar,
    });

    logger.info(`Retrieved invitation ${invitation.id} for user ${userId}`);

    const invitationData: Invitation = {
      invitation_id: invitation.id,
      sender_id: invitation.data.sender_id,
      username: invitation.data.username,
      name: invitation.data.name,
      avatar: invitation.data.avatar,
      created_at: formatTimestamp(invitation.data.created_at),
    };

    return {
      data: invitationData,
      status: 200,
      analytics: {
        event: EventName.INVITE_VIEWED,
        userId: userId,
        params: {
          friend_count: profile.friend_count || 0,
        },
      },
    };
  }

  /**
   * Resets a user's invitation, deleting all existing join requests
   */
  async resetInvitation(userId: string): Promise<ApiResponse<Invitation>> {
    logger.info(`Resetting invitation for user ${userId}`);

    const profile = await this.profileDAO.getById(userId);
    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    // Find existing invitation
    const existing = await this.invitationDAO.getByUser(userId);
    let joinRequestsDeleted = 0;

    if (existing) {
      // Create batch for atomic deletion
      const batch = getFirestore().batch();

      // Delete all join requests for this invitation
      joinRequestsDeleted = await this.joinRequestDAO.deleteAllByInvitation(existing.id, batch);

      // Delete the invitation
      await this.invitationDAO.deleteInvitation(existing.id, batch);

      // Commit the batch
      await batch.commit();

      logger.info(`Deleted ${joinRequestsDeleted} join requests and invitation ${existing.id}`);
    }

    // Create new invitation
    const invitation = await this.invitationDAO.createOrGet(userId, {
      username: profile.username,
      name: profile.name,
      avatar: profile.avatar,
    });

    logger.info(`Created new invitation ${invitation.id} for user ${userId}`);

    const invitationData: Invitation = {
      invitation_id: invitation.id,
      sender_id: invitation.data.sender_id,
      username: invitation.data.username,
      name: invitation.data.name,
      avatar: invitation.data.avatar,
      created_at: formatTimestamp(invitation.data.created_at),
    };

    return {
      data: invitationData,
      status: 200,
      analytics: {
        event: EventName.INVITE_RESET,
        userId: userId,
        params: {
          friend_count: profile.friend_count || 0,
          join_requests_deleted: joinRequestsDeleted,
        },
      },
    };
  }

  /**
   * Requests to join via an invitation
   */
  async requestToJoin(userId: string, invitationId: string): Promise<ApiResponse<JoinRequest>> {
    logger.info(`User ${userId} requesting to join via invitation ${invitationId}`);

    // Get invitation details
    const invitation = await this.invitationDAO.findById(invitationId);
    if (!invitation) {
      throw new NotFoundError('Invitation not found');
    }

    const receiverId = invitation.sender_id;

    // Validate not self-invitation
    if (userId === receiverId) {
      throw new BadRequestError('You cannot send a join request to yourself');
    }

    // Check if already friends
    const areFriends = await this.friendshipDAO.areFriends(userId, receiverId);
    if (areFriends) {
      throw new ConflictError('You are already friends with this user');
    }

    // Check for existing request (both pending and rejected)
    const existingRequest = await this.joinRequestDAO.findExistingRequest(invitationId, userId, [
      JoinRequestStatus.PENDING,
      JoinRequestStatus.REJECTED,
    ]);

    if (existingRequest) {
      if (existingRequest.status === JoinRequestStatus.PENDING) {
        throw new ConflictError('You have already sent a join request to this user');
      } else if (existingRequest.status === JoinRequestStatus.REJECTED) {
        throw new ForbiddenError('Your previous request was rejected. You cannot send another request.');
      }
    }

    // Check friend limit for requester
    const { hasReachedLimit: requesterHasLimit } = await this.friendshipDAO.hasReachedLimit(userId);
    if (requesterHasLimit) {
      throw new BadRequestError('You have reached the maximum number of friends (20)');
    }

    // Get profiles for denormalization
    const [requesterProfile, receiverProfile] = await Promise.all([
      this.profileDAO.getById(userId),
      this.profileDAO.getById(receiverId),
    ]);

    if (!requesterProfile || !receiverProfile) {
      throw new NotFoundError('Profile not found');
    }

    // Create join request
    const requestData: Omit<JoinRequestDoc, 'request_id'> = {
      invitation_id: invitationId,
      requester_id: userId,
      receiver_id: receiverId,
      status: JoinRequestStatus.PENDING,
      created_at: Timestamp.now(),
      updated_at: Timestamp.now(),
      requester_name: requesterProfile.name,
      requester_username: requesterProfile.username,
      requester_avatar: requesterProfile.avatar,
      receiver_name: receiverProfile.name,
      receiver_username: receiverProfile.username,
      receiver_avatar: receiverProfile.avatar,
    };

    const joinRequest = await this.joinRequestDAO.create(invitationId, requestData);

    logger.info(`Created join request ${joinRequest.request_id} for user ${userId}`);

    return {
      data: this.formatJoinRequest(joinRequest),
      status: 201,
      analytics: {
        event: EventName.JOIN_REQUESTED,
        userId: userId,
        params: {
          invitation_id: invitationId,
          receiver_id: receiverId,
        },
      },
    };
  }

  /**
   * Accepts a join request and creates friendship
   */
  async acceptJoinRequest(userId: string, requestId: string): Promise<ApiResponse<Friend>> {
    logger.info(`User ${userId} accepting join request ${requestId}`);

    // Get the user's invitation first (following the pattern from invitation-utils.ts)
    const invitation = await this.invitationDAO.getByUser(userId);
    if (!invitation) {
      throw new NotFoundError('Invitation not found');
    }

    // Now get the join request from the invitation's subcollection
    const joinRequest = await this.joinRequestDAO.getByInvitationAndRequest(invitation.id, requestId);
    if (!joinRequest) {
      throw new NotFoundError('Join request not found');
    }

    const invitationId = invitation.id;

    // Validate ownership
    if (joinRequest.receiver_id !== userId) {
      throw new ForbiddenError('You can only accept requests sent to you');
    }

    // Check if already processed
    if (joinRequest.status !== JoinRequestStatus.PENDING) {
      throw new ConflictError(`Join request has already been ${joinRequest.status}`);
    }

    // Check friend limits
    const [{ hasReachedLimit: receiverHasLimit }, { hasReachedLimit: requesterHasLimit }] = await Promise.all([
      this.friendshipDAO.hasReachedLimit(userId),
      this.friendshipDAO.hasReachedLimit(joinRequest.requester_id),
    ]);

    if (receiverHasLimit) {
      throw new BadRequestError('You have reached the maximum number of friends (20)');
    }

    if (requesterHasLimit) {
      throw new BadRequestError('The requester has reached the maximum number of friends (20)');
    }

    // Create batch for all operations
    const batch = getFirestore().batch();
    const timestamp = Timestamp.now();

    // Get profiles for summaries
    const [requesterProfile, receiverProfile] = await this.profileDAO.fetchMultiple([joinRequest.requester_id, userId]);

    if (!requesterProfile || !receiverProfile) {
      throw new NotFoundError('Profile not found');
    }

    // Note: Friend summaries are generated asynchronously by the on-friendship-creation trigger

    // Create friendship documents
    await this.friendshipDAO.upsertFriend(
      userId,
      joinRequest.requester_id,
      {
        username: requesterProfile.username,
        name: requesterProfile.name,
        avatar: requesterProfile.avatar,
        last_update_emoji: '',
        last_update_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
        accepter_id: userId,
      },
      batch,
    );

    await this.friendshipDAO.upsertFriend(
      joinRequest.requester_id,
      userId,
      {
        username: receiverProfile.username,
        name: receiverProfile.name,
        avatar: receiverProfile.avatar,
        last_update_emoji: '',
        last_update_at: timestamp,
        created_at: timestamp,
        updated_at: timestamp,
        accepter_id: userId,
      },
      batch,
    );

    // Update friend counts using ProfileDAO methods
    this.profileDAO.incrementFriendCount(userId, batch);
    this.profileDAO.incrementFriendCount(joinRequest.requester_id, batch);

    // Delete the join request in the same batch
    this.joinRequestDAO.deleteRequestWithBatch(invitationId, requestId, batch);

    // Commit all operations atomically
    await batch.commit();

    logger.info(`Accepted join request ${requestId} and created friendship`);

    const friend: Friend = {
      user_id: joinRequest.requester_id,
      username: joinRequest.requester_username,
      name: joinRequest.requester_name,
      avatar: joinRequest.requester_avatar,
      last_update_emoji: '',
      last_update_time: formatTimestamp(timestamp),
    };

    return {
      data: friend,
      status: 200,
      analytics: {
        event: EventName.JOIN_REQUEST_ACCEPTED,
        userId: userId,
        params: {
          requester_id: joinRequest.requester_id,
        },
      },
    };
  }

  /**
   * Rejects a join request
   */
  async rejectJoinRequest(userId: string, requestId: string): Promise<ApiResponse<JoinRequest>> {
    logger.info(`User ${userId} rejecting join request ${requestId}`);

    // Get the user's invitation first (following the pattern from invitation-utils.ts)
    const invitation = await this.invitationDAO.getByUser(userId);
    if (!invitation) {
      throw new NotFoundError('Invitation not found');
    }

    // Now get the join request from the invitation's subcollection
    const joinRequest = await this.joinRequestDAO.getByInvitationAndRequest(invitation.id, requestId);
    if (!joinRequest) {
      throw new NotFoundError('Join request not found');
    }

    const invitationId = invitation.id;

    // Validate ownership
    if (joinRequest.receiver_id !== userId) {
      throw new ForbiddenError('You can only reject requests sent to you');
    }

    // Check if already processed
    if (joinRequest.status !== JoinRequestStatus.PENDING) {
      throw new ConflictError(`Join request has already been ${joinRequest.status}`);
    }

    // Update request status
    await this.joinRequestDAO.updateStatus(invitationId, requestId, JoinRequestStatus.REJECTED);

    logger.info(`Rejected join request ${requestId}`);

    return {
      data: this.formatJoinRequest(joinRequest),
      status: 200,
      analytics: {
        event: EventName.JOIN_REQUEST_REJECTED,
        userId: userId,
        params: {
          requester_id: joinRequest.requester_id,
        },
      },
    };
  }

  /**
   * Gets join requests received by a user
   */
  async getJoinRequests(
    userId: string,
    pagination?: { limit?: number; after_cursor?: string },
  ): Promise<ApiResponse<JoinRequestResponse>> {
    logger.info(`Getting join requests for user ${userId}`, { pagination });

    const result = await this.joinRequestDAO.getByUser(userId, {
      limit: pagination?.limit,
      afterCursor: pagination?.after_cursor,
    });

    const requests = this.formatJoinRequests(result.requests);

    logger.info(`Retrieved ${requests.length} join requests for user ${userId}`);

    return {
      data: {
        join_requests: requests,
        next_cursor: result.nextCursor || null,
      },
      status: 200,
      analytics: {
        event: EventName.JOIN_REQUESTS_VIEWED,
        userId: userId,
        params: {
          join_request_count: requests.length,
        },
      },
    };
  }

  /**
   * Gets join requests sent by a user
   */
  async getMyJoinRequests(
    userId: string,
    pagination?: { limit?: number; after_cursor?: string },
  ): Promise<ApiResponse<JoinRequestResponse>> {
    logger.info(`Getting sent join requests for user ${userId}`, { pagination });

    const invitation = await this.invitationDAO.getByUser(userId);
    if (!invitation) {
      return { data: { join_requests: [], next_cursor: null }, status: 200 };
    }

    const result = await this.joinRequestDAO.getByInvitation(invitation.id, {
      limit: pagination?.limit,
      afterCursor: pagination?.after_cursor,
    });

    const requests = this.formatJoinRequests(result.requests);

    logger.info(`Retrieved ${requests.length} sent join requests for user ${userId}`);

    return {
      data: {
        join_requests: requests,
        next_cursor: result.nextCursor || null,
      },
      status: 200,
      analytics: {
        event: EventName.MY_JOIN_REQUESTS_VIEWED,
        userId: userId,
        params: {
          join_request_count: requests.length,
        },
      },
    };
  }

  /**
   * Gets a specific join request by ID
   */
  async getJoinRequest(userId: string, requestId: string): Promise<ApiResponse<JoinRequest>> {
    logger.info(`Getting join request ${requestId} for user ${userId}`);

    // Get the user's invitation
    const invitation = await this.invitationDAO.getByUser(userId);
    if (!invitation) {
      throw new NotFoundError('Invitation not found');
    }

    // Get the specific join request from the subcollection
    const joinRequest = await this.joinRequestDAO.getByInvitationAndRequest(invitation.id, requestId);
    if (!joinRequest) {
      throw new NotFoundError('Join request not found');
    }

    // Check if user is either requester or receiver
    if (userId !== joinRequest.requester_id && userId !== joinRequest.receiver_id) {
      throw new ForbiddenError('You are not authorized to view this join request');
    }

    const formatted: JoinRequest = {
      request_id: joinRequest.request_id,
      invitation_id: joinRequest.invitation_id,
      requester_id: joinRequest.requester_id,
      receiver_id: joinRequest.receiver_id,
      status: joinRequest.status,
      created_at: formatTimestamp(joinRequest.created_at),
      updated_at: formatTimestamp(joinRequest.updated_at),
      requester_name: joinRequest.requester_name,
      requester_username: joinRequest.requester_username,
      requester_avatar: joinRequest.requester_avatar,
      receiver_name: joinRequest.receiver_name,
      receiver_username: joinRequest.receiver_username,
      receiver_avatar: joinRequest.receiver_avatar,
    };

    return {
      data: formatted,
      status: 200,
      analytics: {
        event: EventName.JOIN_REQUEST_VIEWED,
        userId: userId,
        params: {
          invitation_id: invitation.id,
          request_id: requestId,
        },
      },
    };
  }

  private formatJoinRequest(doc: JoinRequestDoc): JoinRequest {
    return {
      request_id: doc.request_id,
      invitation_id: doc.invitation_id,
      requester_id: doc.requester_id,
      receiver_id: doc.receiver_id,
      status: doc.status,
      created_at: formatTimestamp(doc.created_at),
      updated_at: formatTimestamp(doc.updated_at),
      requester_name: doc.requester_name,
      requester_username: doc.requester_username,
      requester_avatar: doc.requester_avatar,
      receiver_name: doc.receiver_name,
      receiver_username: doc.receiver_username,
      receiver_avatar: doc.receiver_avatar,
    };
  }

  /**
   * Formats a list of join request documents into a list of join requests
   */
  private formatJoinRequests(docs: JoinRequestDoc[]): JoinRequest[] {
    const requests: JoinRequest[] = docs.map((doc) => this.formatJoinRequest(doc));
    return requests;
  }
}
