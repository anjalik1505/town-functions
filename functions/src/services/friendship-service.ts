import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateFriendProfileFlow } from '../ai/flows.js';
import { DeviceDAO } from '../dao/device-dao.js';
import { FeedDAO } from '../dao/feed-dao.js';
import { FriendshipDAO } from '../dao/friendship-dao.js';
import { NudgeDAO } from '../dao/nudge-dao.js';
import { ProfileDAO } from '../dao/profile-dao.js';
import { UpdateDAO } from '../dao/update-dao.js';
import { UserSummaryDAO } from '../dao/user-summary-dao.js';
import {
  ApiResponse,
  EventName,
  FriendshipAcceptanceEventParams,
  FriendSummaryEventParams,
} from '../models/analytics-events.js';
import { Friend, FriendsResponse, NudgeResponse } from '../models/api-responses.js';
import { NotificationTypes } from '../models/constants.js';
import { ProfileData, SummaryContext, SummaryResult } from '../models/data-models.js';
import { ProfileDoc, SimpleProfile, uf, UpdateDoc, UserProfile } from '../models/firestore/index.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { commitBatch, commitFinal } from '../utils/batch-utils.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { calculateAge, createSummaryId } from '../utils/profile-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';
import { NotificationService } from './notification-service.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

const NUDGE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour in milliseconds

/**
 * Service layer for Friendship operations
 * Handles friendship creation, sync, and related operations
 */
export class FriendshipService {
  private friendshipDAO: FriendshipDAO;
  private profileDAO: ProfileDAO;
  private updateDAO: UpdateDAO;
  private feedDAO: FeedDAO;
  private userSummaryDAO: UserSummaryDAO;
  private nudgeDAO: NudgeDAO;
  private deviceDAO: DeviceDAO;
  private notificationService: NotificationService;
  private db = getFirestore();

  constructor() {
    this.friendshipDAO = new FriendshipDAO();
    this.profileDAO = new ProfileDAO();
    this.updateDAO = new UpdateDAO();
    this.feedDAO = new FeedDAO();
    this.userSummaryDAO = new UserSummaryDAO();
    this.nudgeDAO = new NudgeDAO();
    this.deviceDAO = new DeviceDAO();
    this.notificationService = new NotificationService();
  }

  /**
   * Processes a new friendship creation
   * Syncs updates between friends and returns notification data and analytics
   */
  async processFriendshipCreation(
    userId: string,
    friendId: string,
    accepterId: string,
  ): Promise<{
    requesterNotification: {
      userId: string;
      title: string;
      message: string;
      data: { type: string };
    };
    analyticsEvent: {
      eventName: EventName;
      params: FriendshipAcceptanceEventParams;
      userId: string;
    };
  }> {
    logger.info(`Processing friendship creation between ${userId} and ${friendId}`);

    try {
      // Fetch both profiles once at the beginning
      const profiles = await this.profileDAO.getAll([userId, friendId]);
      const userProfile = profiles.find((profile) => profile.user_id === userId);
      const friendProfile = profiles.find((profile) => profile.user_id === friendId);

      if (!userProfile || !friendProfile) {
        logger.error(`Missing profile data: user=${!!userProfile}, friend=${!!friendProfile}`);
        throw new Error('Missing profile data');
      }

      // Convert ProfileDoc to UserProfile for shareUpdate
      const userProfileForShare: UserProfile = {
        user_id: userId,
        username: userProfile.username || '',
        name: userProfile.name || '',
        avatar: userProfile.avatar || '',
      };

      const friendProfileForShare: UserProfile = {
        user_id: friendId,
        username: friendProfile.username || '',
        name: friendProfile.name || '',
        avatar: friendProfile.avatar || '',
      };

      // Process friendship sync in both directions
      const [friendUpdateInfo, userUpdateInfo] = await Promise.all([
        this.syncFriendshipUpdates(friendId, userId, friendProfile, userProfile, userProfileForShare), // Friend's updates to user's feed
        this.syncFriendshipUpdates(userId, friendId, userProfile, friendProfile, friendProfileForShare), // User's updates to friend's feed
      ]);

      logger.info(`Successfully synced friendship data for ${userId} <-> ${friendId}`);

      // Update friend documents with latest update info
      const batch = this.db.batch();
      let hasUpdates = false;

      // Update userId's friend document about friendId with friendId's latest update info
      if (friendUpdateInfo) {
        await this.friendshipDAO.upsert(
          userId,
          friendId,
          {
            last_update_emoji: friendUpdateInfo.emoji,
            last_update_at: friendUpdateInfo.updatedAt,
          },
          batch,
        );
        hasUpdates = true;
      }

      // Update friendId's friend document about userId with userId's latest update info
      if (userUpdateInfo) {
        await this.friendshipDAO.upsert(
          friendId,
          userId,
          {
            last_update_emoji: userUpdateInfo.emoji,
            last_update_at: userUpdateInfo.updatedAt,
          },
          batch,
        );
        hasUpdates = true;
      }

      if (hasUpdates) {
        await batch.commit();
        logger.info(`Updated friend documents with latest update info`);
      }

      // Prepare notification data and analytics event (accepterId is always present)
      const accepterProfile = accepterId === userId ? userProfile : friendProfile;
      const requesterId = accepterId === userId ? friendId : userId;

      logger.info(`Preparing acceptance notification: requester=${requesterId}, accepter=${accepterId}`);

      const accepterName = accepterProfile.name || accepterProfile.username || 'Friend';
      const message = `${accepterName} accepted your request!`;

      return {
        requesterNotification: {
          userId: requesterId,
          title: 'New Friend!',
          message: message,
          data: {
            type: NotificationTypes.FRIENDSHIP,
          },
        },
        analyticsEvent: {
          eventName: EventName.FRIENDSHIP_ACCEPTED,
          params: {
            sender_has_name: !!accepterProfile.name || !!accepterProfile.username,
            sender_has_avatar: !!accepterProfile.avatar,
            receiver_has_name:
              !!userProfile.name || !!userProfile.username || !!friendProfile.name || !!friendProfile.username,
            receiver_has_avatar: !!userProfile.avatar || !!friendProfile.avatar,
            has_device: true, // Will be determined when actually sending
          } as FriendshipAcceptanceEventParams,
          userId: requesterId,
        },
      };
    } catch (error) {
      logger.error(`Failed to process friendship creation ${userId}/${friendId}`, error);
      throw error;
    }
  }

  /**
   * Processes friend summaries for update creation
   * @param updateData The update document data
   * @param imageAnalysis Already analyzed image description text
   * @returns Analytics data for friend summaries
   */
  async processUpdateFriendSummaries(
    updateData: UpdateDoc,
    imageAnalysis: string,
  ): Promise<FriendSummaryEventParams[]> {
    const creatorId = updateData[uf('created_by')];
    const friendIds = updateData[uf('friend_ids')] || [];
    const emoji = updateData[uf('emoji')];

    if (!creatorId || friendIds.length === 0) {
      logger.info('No creator ID or friends found for update');
      return [];
    }

    logger.info(`Processing friend summaries for update from ${creatorId} to ${friendIds.length} friends`);

    // Get creator profile
    const creatorProfile = await this.profileDAO.get(creatorId);
    if (!creatorProfile) {
      logger.warn(`Creator profile not found: ${creatorId}`);
      return [];
    }

    // Create a batch for all friend summary updates
    let batch = this.db.batch();
    let batchCount = 0;
    const friendSummaryEvents: FriendSummaryEventParams[] = [];

    // Process each friend
    for (const friendId of friendIds) {
      try {
        // Get friend profile
        const friendProfile = await this.profileDAO.get(friendId);
        if (!friendProfile) {
          logger.warn(`Friend profile not found: ${friendId}`);
          continue;
        }

        // Get summary context
        const summaryContext = await this.getSummaryContext(creatorId, friendId, creatorProfile, friendProfile);

        // Generate friend summary
        const summaryResult = await this.generateFriendSummary(
          summaryContext,
          updateData,
          imageAnalysis,
          creatorProfile,
        );

        // Write the summary to database using batch
        await this.userSummaryDAO.createOrUpdateSummary(
          creatorId,
          friendId,
          {
            summary: summaryResult.summary,
            suggestions: summaryResult.suggestions,
            lastUpdateId: summaryResult.updateId,
            updateCount: summaryContext.updateCount,
          },
          batch,
        );
        batchCount++;

        // Update friend document with emoji if provided
        if (emoji) {
          await this.friendshipDAO.upsert(
            friendId,
            creatorId,
            {
              last_update_emoji: emoji,
              last_update_at: updateData[uf('created_at')],
            },
            batch,
          );
          batchCount++;
        }

        friendSummaryEvents.push(summaryResult.analytics);

        // Commit batch if approaching limit
        const result = await commitBatch(this.db, batch, batchCount);
        batch = result.batch;
        batchCount = result.batchCount;
      } catch (error) {
        logger.error(`Failed to process friend summary for ${friendId}`, error);
      }
    }

    await commitFinal(batch, batchCount);

    return friendSummaryEvents;
  }

  /**
   * Updates friend profile denormalization in the friends subcollections
   */
  async updateFriendProfileDenormalization(userId: string, newProfile: SimpleProfile): Promise<number> {
    logger.info(`Updating friend profile denormalization for user ${userId}`);

    let totalUpdates = 0;

    try {
      // Get list of friends for this user
      const friendIds = await this.friendshipDAO.getFriendIds(userId);

      if (friendIds.length === 0) {
        logger.info(`User ${userId} has no friends to update`);
        return 0;
      }

      let batch = this.db.batch();
      let batchCount = 0;

      // Update this user's profile data in each friend's FRIENDS subcollection
      for (const friendId of friendIds) {
        await this.friendshipDAO.updateFriendProfile(friendId, userId, newProfile, batch);
        batchCount++;
        totalUpdates++;

        // Commit batch if approaching limit
        const result = await commitBatch(this.db, batch, batchCount);
        batch = result.batch;
        batchCount = result.batchCount;
      }

      await commitFinal(batch, batchCount);
      logger.info(`Updated ${totalUpdates} friend profile references for user ${userId}`);
      return totalUpdates;
    } catch (error) {
      logger.error(`Error updating friend profile denormalization for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Syncs all_village updates from one user to another's feed
   * and generates friend summaries
   */
  private async syncFriendshipUpdates(
    sourceUserId: string,
    targetUserId: string,
    sourceProfile: ProfileDoc,
    targetProfile: ProfileDoc,
    targetProfileForShare: UserProfile,
  ): Promise<{ emoji?: string; updatedAt?: Timestamp } | undefined> {
    let batch = this.db.batch();
    let batchCount = 0;
    const lastUpdates: UpdateDoc[] = [];
    let latestInfo: { emoji?: string; updatedAt?: Timestamp } | undefined;

    try {
      // Stream all_village updates from source user
      for await (const update of this.updateDAO.streamUpdates(sourceUserId)) {
        // Capture first (latest) update info
        if (!latestInfo) {
          latestInfo = { emoji: update.emoji || '', updatedAt: update.created_at };
        }

        // Keep last 10 for summaries
        if (lastUpdates.length < 10) {
          lastUpdates.push(update);
        }

        // Create feed item
        await this.feedDAO.create(
          [
            {
              userId: targetUserId,
              updateId: update.id,
              createdAt: update.created_at,
              directVisible: true,
              friendId: sourceUserId,
              groupIds: [],
              createdBy: sourceUserId,
            },
          ],
          batch,
        );
        batchCount++;

        // Use shareUpdate to properly update visible_to and friend_ids
        const currentFriendIds = update.friend_ids || [];
        if (!currentFriendIds.includes(targetUserId)) {
          await this.updateDAO.share(
            update.id,
            [targetUserId], // additionalFriendIds
            [], // additionalGroupIds
            [targetProfileForShare], // additionalFriendsProfiles
            [], // additionalGroupsProfiles
            batch,
          );
          batchCount++; // shareUpdate adds operations to the batch
        }

        const result = await commitBatch(this.db, batch, batchCount);
        batch = result.batch;
        batchCount = result.batchCount;
      }

      if (lastUpdates.length === 0) {
        logger.info(`No all_village updates found for sender ${sourceUserId}`);
        return latestInfo;
      }

      // Process friend summaries with pre-fetched profiles
      batchCount = await this.processFriendSummaries(
        lastUpdates,
        sourceUserId,
        targetUserId,
        sourceProfile,
        targetProfile,
        batch,
        batchCount,
      );

      await commitFinal(batch, batchCount);

      return latestInfo;
    } catch (error) {
      logger.error(`Error processing friendship sync ${sourceUserId} -> ${targetUserId}:`, error);
      return undefined;
    }
  }

  /**
   * Processes friend summaries for the synced updates
   */
  private async processFriendSummaries(
    updates: UpdateDoc[],
    sourceUserId: string,
    targetUserId: string,
    sourceProfile: ProfileDoc,
    targetProfile: ProfileDoc,
    batch: FirebaseFirestore.WriteBatch,
    batchCount: number,
  ): Promise<number> {
    // Process updates from oldest to newest
    const orderedUpdates = [...updates].reverse();

    // Get the summary context with pre-fetched profiles
    const summaryContext = await this.getSummaryContext(sourceUserId, targetUserId, sourceProfile, targetProfile);

    // Create a single batch for all summary updates
    const friendSummaryEvents: FriendSummaryEventParams[] = [];
    let latestSummaryResult: SummaryResult | null = null;

    // Process each update for friend summary
    for (const updateData of orderedUpdates) {
      // Use stored image analysis or fallback to processing images
      const imageAnalysis = updateData.image_analysis || '';

      // Generate the summary
      const summaryResult = await this.generateFriendSummary(summaryContext, updateData, imageAnalysis, sourceProfile);

      summaryContext.existingSummary = summaryResult.summary;
      summaryContext.existingSuggestions = summaryResult.suggestions;
      latestSummaryResult = summaryResult;

      friendSummaryEvents.push(summaryResult.analytics);
    }

    // Write the final summary
    if (latestSummaryResult) {
      await this.userSummaryDAO.createOrUpdateSummary(
        sourceUserId,
        targetUserId,
        {
          summary: latestSummaryResult.summary,
          suggestions: latestSummaryResult.suggestions,
          lastUpdateId: latestSummaryResult.updateId,
          updateCount: summaryContext.updateCount,
        },
        batch,
      );
      batchCount++;
      const result = await commitBatch(this.db, batch, batchCount);
      batch = result.batch;
      batchCount = result.batchCount;

      // Track analytics
      trackApiEvents(
        friendSummaryEvents.map((params) => ({
          eventName: EventName.FRIEND_SUMMARY_CREATED,
          params,
        })),
        sourceUserId,
      );
      return batchCount;
    }
    return batchCount;
  }

  /**
   * Gets the summary context for friend summary generation
   */
  private async getSummaryContext(
    creatorId: string,
    friendId: string,
    SimpleProfileData: ProfileDoc,
    friendProfileData: ProfileDoc,
  ): Promise<SummaryContext> {
    const summaryId = createSummaryId(friendId, creatorId);

    // Get existing summary using UserSummaryDAO
    const existingSummaryDoc = await this.userSummaryDAO.get(summaryId);

    // Extract data from existing summary or initialize new data
    let existingSummary = '';
    let existingSuggestions = '';
    let updateCount = 1;
    let isNewSummary = true;
    let existingCreatedAt: Timestamp | undefined = undefined;

    if (existingSummaryDoc) {
      existingSummary = existingSummaryDoc.summary || '';
      existingSuggestions = existingSummaryDoc.suggestions || '';
      updateCount = (existingSummaryDoc.update_count || 0) + 1;
      isNewSummary = false;
      existingCreatedAt = existingSummaryDoc.created_at;
    }

    const SimpleProfile: ProfileData = {
      name: SimpleProfileData.username || SimpleProfileData.name || 'Friend',
      gender: SimpleProfileData.gender || 'unknown',
      location: SimpleProfileData.location || 'unknown',
      age: calculateAge(SimpleProfileData.birthday),
    };

    const friendProfile: ProfileData = {
      name: friendProfileData.username || friendProfileData.name || 'Friend',
      gender: friendProfileData.gender || 'unknown',
      location: friendProfileData.location || 'unknown',
      age: calculateAge(friendProfileData.birthday),
    };

    // Return context without summaryRef - we use UserSummaryDAO for writes
    return {
      summaryId,
      existingSummary,
      existingSuggestions,
      updateCount,
      isNewSummary,
      existingCreatedAt,
      creatorProfile: SimpleProfile,
      friendProfile,
    } as SummaryContext;
  }

  private async generateFriendSummary(
    context: SummaryContext,
    updateData: UpdateDoc,
    imageAnalysis: string,
    creatorProfileData: ProfileDoc,
  ): Promise<SummaryResult> {
    // Extract update content and sentiment
    const updateContent = updateData.content || '';
    const sentiment = updateData.sentiment || '';
    const updateId = updateData.id;

    // Use the friend profile flow to generate summary and suggestions
    const result = await generateFriendProfileFlow({
      existingSummary: context.existingSummary,
      existingSuggestions: context.existingSuggestions,
      updateContent: updateContent,
      sentiment: sentiment,
      friendName: context.friendProfile.name,
      friendGender: context.friendProfile.gender,
      friendLocation: context.friendProfile.location,
      friendAge: context.friendProfile.age,
      userName: context.creatorProfile.name,
      userGender: context.creatorProfile.gender,
      userLocation: context.creatorProfile.location,
      userAge: context.creatorProfile.age,
      imageAnalysis: imageAnalysis,
      totalUpdatesShared: creatorProfileData.update_count || 0,
    });

    // Return the result with analytics data
    return {
      summary: result.summary || '',
      suggestions: result.suggestions || '',
      updateId,
      analytics: {
        summary_length: (result.summary || '').length,
        suggestions_length: (result.suggestions || '').length,
      },
    };
  }

  /**
   * Gets user's friends with pagination
   */
  async getFriends(
    userId: string,
    pagination?: { limit?: number; after_cursor?: string },
  ): Promise<ApiResponse<FriendsResponse>> {
    logger.info(`Getting friends for user ${userId}`, { pagination });

    const limit = pagination?.limit || 20;
    const afterCursor = pagination?.after_cursor;

    const result = await this.friendshipDAO.getFriends(userId, limit, afterCursor);

    logger.info(`Retrieved ${result.friends.length} friends for user ${userId}`);

    return {
      data: {
        friends: result.friends.map(
          (friend) =>
            ({
              user_id: friend.userId,
              username: friend.username,
              name: friend.name,
              avatar: friend.avatar,
              last_update_emoji: friend.last_update_emoji,
              last_update_time: formatTimestamp(friend.last_update_at),
            }) as Friend,
        ),
        next_cursor: result.nextCursor,
      } as FriendsResponse,
      status: 200,
      analytics: {
        event: EventName.FRIENDS_VIEWED,
        userId: userId,
        params: { friend_count: result.friends.length },
      },
    };
  }

  /**
   * Removes a friend (bidirectional)
   */
  async removeFriend(userId: string, friendId: string): Promise<ApiResponse<null>> {
    logger.info(`Removing friendship: ${userId} <-> ${friendId}`);

    const areFriends = await this.friendshipDAO.areFriends(userId, friendId);

    if (!areFriends) {
      throw new NotFoundError('Friendship not found');
    }

    // Create a batch for atomic operations
    const batch = this.db.batch();

    // Remove friendship documents in the batch
    await this.friendshipDAO.remove(userId, friendId, batch);

    // Decrement friend counts for both users in the same batch
    this.profileDAO.decrementFriendCount(userId, batch);
    this.profileDAO.decrementFriendCount(friendId, batch);

    // Commit all operations atomically
    await batch.commit();

    logger.info(`Successfully removed friendship and updated friend counts for ${userId} and ${friendId}`);

    return {
      data: null,
      status: 200,
      analytics: {
        event: EventName.FRIENDSHIP_REMOVED,
        userId: userId,
        params: { friend_id: friendId },
      },
    };
  }

  /**
   * Nudges a user with rate limiting and friendship validation
   */
  async nudgeUser(currentUserId: string, targetUserId: string): Promise<ApiResponse<NudgeResponse>> {
    logger.info(`User ${currentUserId} nudging user ${targetUserId}`);

    if (currentUserId === targetUserId) {
      throw new BadRequestError('You cannot nudge yourself');
    }

    // Check friendship
    const areFriends = await this.friendshipDAO.areFriends(currentUserId, targetUserId);
    if (!areFriends) {
      throw new ForbiddenError('You must be friends with this user to nudge them');
    }

    // Check rate limiting
    const canNudge = await this.nudgeDAO.canSend(targetUserId, currentUserId, NUDGE_COOLDOWN_MS);
    if (!canNudge) {
      throw new ConflictError('You can only nudge this user once per hour');
    }

    // Get profiles for notification
    const [currentProfile, targetProfile] = await Promise.all([
      this.profileDAO.get(currentUserId),
      this.profileDAO.get(targetUserId),
    ]);

    if (!currentProfile || !targetProfile) {
      throw new NotFoundError('Profile not found');
    }

    // Check if target user has a device for notifications
    const hasDevice = await this.deviceDAO.exists(targetUserId);

    // Upsert nudge record
    await this.nudgeDAO.upsert(targetUserId, currentUserId);

    // Send notification only if device exists
    if (hasDevice) {
      const currentUserName = currentProfile.name || currentProfile.username || 'A friend';
      try {
        this.notificationService.sendNotification(
          [targetUserId],
          'You’ve been on someone’s mind',
          `${currentUserName} is checking in and curious about how you're doing!`,
          {
            type: NotificationTypes.NUDGE,
            nudger_id: currentUserId,
          },
        );
        logger.info(`Successfully sent nudge notification to user ${targetUserId}`);
      } catch (error) {
        logger.error(`Error sending nudge notification to user ${targetUserId}: ${error}`);
        // Continue execution even if notification fails
      }
    }

    logger.info(`Successfully nudged user ${targetUserId}`);

    return {
      data: { message: 'Nudge sent successfully' },
      status: 200,
      analytics: {
        event: EventName.USER_NUDGED,
        userId: currentUserId,
        params: { target_user_id: targetUserId },
      },
    };
  }
}
