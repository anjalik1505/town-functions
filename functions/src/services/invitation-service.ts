import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { FriendshipDAO } from '../dao/friendship-dao.js';
import { InvitationDAO } from '../dao/invitation-dao.js';
import { JoinRequestDAO } from '../dao/join-request-dao.js';
import { PhoneDAO } from '../dao/phone-dao.js';
import { ProfileDAO } from '../dao/profile-dao.js';
import { ApiResponse, EventName, InvitationNotificationEventParams } from '../models/analytics-events.js';
import { Friend, Invitation, JoinRequest, JoinRequestResponse } from '../models/api-responses.js';
import { NotificationTypes } from '../models/constants.js';
import { JoinRequestDoc, JoinRequestStatus, SimpleProfile } from '../models/firestore/index.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Service layer for Invitation-related operations
 * Coordinates between InvitationDAO, JoinRequestDAO, PhoneDAO, ProfileDAO, and FriendshipDAO
 */
export class InvitationService {
  private invitationDAO: InvitationDAO;
  private joinRequestDAO: JoinRequestDAO;
  private phoneDAO: PhoneDAO;
  private profileDAO: ProfileDAO;
  private friendshipDAO: FriendshipDAO;
  private db: FirebaseFirestore.Firestore;

  constructor() {
    this.invitationDAO = new InvitationDAO();
    this.joinRequestDAO = new JoinRequestDAO();
    this.phoneDAO = new PhoneDAO();
    this.profileDAO = new ProfileDAO();
    this.friendshipDAO = new FriendshipDAO();
    this.db = getFirestore();
  }

  /**
   * Gets or creates an invitation for a user
   */
  async getInvitation(userId: string): Promise<ApiResponse<Invitation>> {
    logger.info(`Getting invitation for user ${userId}`);

    const profile = await this.profileDAO.get(userId);
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

    const profile = await this.profileDAO.get(userId);
    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    // Find existing invitation
    const existing = await this.invitationDAO.getByUser(userId);
    let joinRequestsDeleted = 0;

    if (existing) {
      // Paginate through join requests to count how many will be deleted
      let nextCursor: string | null | undefined = undefined;
      do {
        const { requests, nextCursor: cursor } = await this.joinRequestDAO.getByInvitation(existing.id, {
          limit: 500,
          afterCursor: nextCursor ?? undefined,
        });
        joinRequestsDeleted += requests.length;
        nextCursor = cursor;
      } while (nextCursor);

      // Delete the invitation (recursive delete also removes join_requests subcollection)
      await this.invitationDAO.delete(existing.id);

      logger.info(`Deleted invitation ${existing.id} and ${joinRequestsDeleted} associated join request(s)`);
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
    const invitation = await this.invitationDAO.getByInvitationId(invitationId);
    if (!invitation) {
      throw new NotFoundError('Invitation not found');
    }

    const receiverId = invitation.sender_id;

    // Use the common join request creation logic
    return await this.createJoinRequestInternal(userId, receiverId, invitationId);
  }

  /**
   * Requests to join via a phone number
   */
  async requestToJoinByPhone(userId: string, phoneNumber: string): Promise<ApiResponse<JoinRequest>> {
    logger.info(`User ${userId} requesting to join via phone number ${phoneNumber}`);

    // Get user data for the phone number
    const phoneData = await this.phoneDAO.get(phoneNumber);
    if (!phoneData) {
      throw new NotFoundError('Phone number not found');
    }

    const receiverId = phoneData.user_id;

    // Validate not self-invitation
    if (userId === receiverId) {
      throw new BadRequestError('You cannot send a join request to yourself');
    }

    // Get or create invitation for the phone number owner
    const invitation = await this.invitationDAO.createOrGet(receiverId, {
      username: phoneData.username,
      name: phoneData.name,
      avatar: phoneData.avatar,
    });

    // Use the common join request creation logic
    return await this.createJoinRequestInternal(userId, receiverId, invitation.id);
  }

  /**
   * Common logic for creating join requests with validation
   * @private
   */
  private async createJoinRequestInternal(
    userId: string,
    receiverId: string,
    invitationId: string,
  ): Promise<ApiResponse<JoinRequest>> {
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
    const existingRequest = await this.joinRequestDAO.get(invitationId, userId, [
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
      this.profileDAO.get(userId),
      this.profileDAO.get(receiverId),
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
      data: this.formatJoinRequest(joinRequest, joinRequest.request_id),
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
    const batch = this.db.batch();
    const timestamp = Timestamp.now();
    const oneYearAgo = new Timestamp(timestamp.seconds - 365 * 24 * 60 * 60, timestamp.nanoseconds);

    // Get profiles for summaries
    const [requesterProfile, receiverProfile] = await this.profileDAO.getAll([joinRequest.requester_id, userId]);

    if (!requesterProfile || !receiverProfile) {
      throw new NotFoundError('Profile not found');
    }

    // Note: Friend summaries are generated asynchronously by the on-friendship-creation trigger

    // Create friendship documents
    await this.friendshipDAO.upsert(
      userId,
      joinRequest.requester_id,
      {
        username: requesterProfile.username,
        name: requesterProfile.name,
        avatar: requesterProfile.avatar,
        last_update_emoji: '',
        last_update_at: oneYearAgo,
        created_at: timestamp,
        updated_at: timestamp,
        accepter_id: userId,
      },
      batch,
    );

    await this.friendshipDAO.upsert(
      joinRequest.requester_id,
      userId,
      {
        username: receiverProfile.username,
        name: receiverProfile.name,
        avatar: receiverProfile.avatar,
        last_update_emoji: '',
        last_update_at: oneYearAgo,
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
    this.joinRequestDAO.delete(invitationId, requestId, batch);

    // Commit all operations atomically
    await batch.commit();

    logger.info(`Accepted join request ${requestId} and created friendship`);

    const friend: Friend = {
      user_id: joinRequest.requester_id,
      username: joinRequest.requester_username,
      name: joinRequest.requester_name,
      avatar: joinRequest.requester_avatar,
      last_update_emoji: '',
      last_update_time: formatTimestamp(oneYearAgo),
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
      data: this.formatJoinRequest(joinRequest, requestId),
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

  private formatJoinRequest(doc: JoinRequestDoc, requestId: string): JoinRequest {
    return {
      request_id: requestId,
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
   * Prepares no-friends notifications for all users who have no friends
   * Streams all profiles and processes eligibility for each user
   * @returns Array of notifications to send and analytics results with user IDs for mapping
   */
  async prepareNoFriendsNotifications(): Promise<{
    notifications: Array<{
      userId: string;
      title: string;
      message: string;
      data: { type: string };
    }>;
    analyticsResults: Array<InvitationNotificationEventParams & { userId: string }>;
  }> {
    const MIN_PROFILE_AGE_DAYS = 1;
    const NOTIFICATION_TITLE = 'Your Village wants to hear from you!';
    const NOTIFICATION_BODY =
      'Invite your friends to your Village so they can get your private daily updates and stay connected effortlessly!';

    logger.info('Starting no-friends notification preparation for all users');

    const notifications: Array<{
      userId: string;
      title: string;
      message: string;
      data: { type: string };
    }> = [];

    const analyticsResults: Array<InvitationNotificationEventParams & { userId: string }> = [];

    try {
      // Stream all profiles using ProfileDAO
      for await (const { id: userId, data: profileData } of this.profileDAO.streamAll()) {
        if (!profileData) {
          logger.warn(`No profile data found for user ${userId}`);
          analyticsResults.push({
            userId,
            has_friends: false,
            has_timestamp: false,
            profile_too_new: false,
            has_device: false,
          });
          continue;
        }

        try {
          // Check if the user has friends
          const { friendCount } = await this.friendshipDAO.hasReachedLimit(userId);
          if (friendCount > 0) {
            logger.info(`User ${userId} has friends, skipping no-friends notification.`);
            analyticsResults.push({
              userId,
              has_friends: true,
              has_timestamp: true,
              profile_too_new: false,
              has_device: true,
            });
            continue;
          }

          // Check profile age
          const profileTimestamp = profileData.created_at;
          if (!profileTimestamp) {
            logger.warn(`User ${userId} has no created_at timestamp.`);
            analyticsResults.push({
              userId,
              has_friends: false,
              has_timestamp: false,
              profile_too_new: false,
              has_device: true,
            });
            continue;
          }

          const profileAgeMs = Date.now() - profileTimestamp.toDate().getTime();
          const minProfileAgeMs = MIN_PROFILE_AGE_DAYS * 24 * 60 * 60 * 1000;

          if (profileAgeMs < minProfileAgeMs) {
            logger.info(
              `User ${userId} profile is too new (age: ${Math.floor(profileAgeMs / (24 * 60 * 60 * 1000))} days), skipping.`,
            );
            analyticsResults.push({
              userId,
              has_friends: false,
              has_timestamp: true,
              profile_too_new: true,
              has_device: true,
            });
            continue;
          }

          // User is eligible for notification
          notifications.push({
            userId,
            title: NOTIFICATION_TITLE,
            message: NOTIFICATION_BODY,
            data: {
              type: NotificationTypes.NO_FRIENDS_REMINDER,
            },
          });

          analyticsResults.push({
            userId,
            has_friends: false,
            has_timestamp: true,
            profile_too_new: false,
            has_device: true,
          });

          logger.info(`Prepared no-friends notification for user ${userId}`);
        } catch (error) {
          logger.error(`Failed to process user ${userId} for no-friends notification`, error);
          analyticsResults.push({
            userId,
            has_friends: false,
            has_timestamp: false,
            profile_too_new: false,
            has_device: false,
          });
        }
      }

      logger.info(
        `Completed no-friends notification preparation: ${notifications.length} notifications prepared, ${analyticsResults.length} users processed`,
      );

      return {
        notifications,
        analyticsResults,
      };
    } catch (error) {
      logger.error('Error streaming profiles for no-friends notifications:', error);
      throw error;
    }
  }

  /**
   * Formats a list of join request documents into a list of join requests
   */
  private formatJoinRequests(docs: (JoinRequestDoc & { request_id: string })[]): JoinRequest[] {
    const requests: JoinRequest[] = docs.map((doc) => this.formatJoinRequest(doc, doc.request_id));
    return requests;
  }

  /**
   * Updates profile denormalization across all invitation-related collections
   * Handles sender profiles in invitations, requester profiles in join requests, and receiver profiles in join requests
   * Uses efficient streaming methods and batch operations for scalability
   */
  async updateProfileDenormalization(userId: string, newProfile: SimpleProfile): Promise<number> {
    logger.info(`Updating profile denormalization in invitations for user ${userId}`);

    let totalUpdates = 0;

    try {
      // 1. Update sender profile in invitations where user is the sender
      const userInvitation = await this.invitationDAO.getByUser(userId);
      if (userInvitation) {
        await this.invitationDAO.updateSenderProfile(userInvitation.ref, newProfile);
        totalUpdates++;
        logger.info(`Updated sender profile in invitation for user ${userId}`);
      }

      // 2. Update requester profiles in join requests where user is the requester
      // Use streaming method with built-in batch management
      const requesterUpdates = await this.joinRequestDAO.updateRequesterProfileDenormalization(userId, newProfile);
      totalUpdates += requesterUpdates;
      logger.info(`Updated ${requesterUpdates} requester profile references for user ${userId}`);

      // 3. Update receiver profiles in join requests where user is the receiver (invitation owner)
      if (userInvitation) {
        const receiverUpdates = await this.joinRequestDAO.updateReceiverProfileDenormalization(
          userInvitation.id,
          newProfile,
        );
        totalUpdates += receiverUpdates;
        logger.info(`Updated ${receiverUpdates} receiver profile references for invitation ${userInvitation.id}`);
      }

      logger.info(`Updated ${totalUpdates} invitation-related profile references for user ${userId}`);
      return totalUpdates;
    } catch (error) {
      logger.error(`Error updating profile denormalization in invitations for user ${userId}:`, error);
      throw error;
    }
  }
}
