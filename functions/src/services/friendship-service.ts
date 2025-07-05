import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { FeedDAO } from '../dao/feed-dao.js';
import { FriendshipDAO } from '../dao/friendship-dao.js';
import { ProfileDAO } from '../dao/profile-dao.js';
import { UpdateDAO } from '../dao/update-dao.js';
import { UserSummaryDAO } from '../dao/user-summary-dao.js';
import { EventName, FriendshipAcceptanceEventParams, FriendSummaryEventParams } from '../models/analytics-events.js';
import { MAX_BATCH_OPERATIONS, NotificationTypes } from '../models/constants.js';
import { ProfileData, SummaryContext, SummaryResult } from '../models/data-models.js';
import { ProfileDoc } from '../models/firestore/profile-doc.js';
import { CreatorProfile, uf, UpdateDoc, UserProfile } from '../models/firestore/update-doc.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { calculateAge, createSummaryId } from '../utils/profile-utils.js';
import { generateFriendSummary } from '../utils/summary-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

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
  private db = getFirestore();

  constructor() {
    this.friendshipDAO = new FriendshipDAO();
    this.profileDAO = new ProfileDAO();
    this.updateDAO = new UpdateDAO();
    this.feedDAO = new FeedDAO();
    this.userSummaryDAO = new UserSummaryDAO();
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

        // Commit batch if getting large
        if (batchCount >= MAX_BATCH_OPERATIONS) {
          await batch.commit();
          batch = this.db.batch();
          batchCount = 0;
        }
      }

      // Commit any remaining operations
      if (batchCount > 0) {
        await batch.commit();
      }

      if (lastUpdates.length === 0) {
        logger.info(`No all_village updates found for sender ${sourceUserId}`);
        return latestInfo;
      }

      // Process friend summaries with pre-fetched profiles
      await this.processFriendSummaries(lastUpdates, sourceUserId, targetUserId, sourceProfile, targetProfile);

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
  ): Promise<void> {
    // Process updates from oldest to newest
    const orderedUpdates = [...updates].reverse();

    // Get the summary context with pre-fetched profiles
    const summaryContext = await this.getSummaryContext(sourceUserId, targetUserId, sourceProfile, targetProfile);

    // Create a single batch for all summary updates
    const summaryBatch = this.db.batch();
    const friendSummaryEvents: FriendSummaryEventParams[] = [];
    let latestSummaryResult: SummaryResult | null = null;

    // Process each update for friend summary
    for (const updateData of orderedUpdates) {
      // Use stored image analysis or fallback to processing images
      const imageAnalysis = updateData.image_analysis || '';

      // Generate the summary
      const summaryResult = await generateFriendSummary(summaryContext, updateData, imageAnalysis);

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
        summaryBatch,
      );
      await summaryBatch.commit();

      // Track analytics
      trackApiEvents(
        friendSummaryEvents.map((params) => ({
          eventName: EventName.FRIEND_SUMMARY_CREATED,
          params,
        })),
        sourceUserId,
      );
    }
  }

  /**
   * Gets the summary context for friend summary generation
   */
  private async getSummaryContext(
    creatorId: string,
    friendId: string,
    creatorProfileData: ProfileDoc,
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

    const creatorProfile: ProfileData = {
      name: creatorProfileData.username || creatorProfileData.name || 'Friend',
      gender: creatorProfileData.gender || 'unknown',
      location: creatorProfileData.location || 'unknown',
      age: calculateAge(creatorProfileData.birthday),
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
      creatorProfile,
      friendProfile,
    } as SummaryContext;
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
    const batch = this.db.batch();
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
        const summaryResult = await generateFriendSummary(summaryContext, updateData, imageAnalysis);

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
        }

        friendSummaryEvents.push(summaryResult.analytics);
      } catch (error) {
        logger.error(`Failed to process friend summary for ${friendId}`, error);
      }
    }

    // Commit all updates
    if (friendSummaryEvents.length > 0) {
      await batch.commit();
      logger.info(`Successfully committed ${friendSummaryEvents.length} friend summary updates`);
    }

    return friendSummaryEvents;
  }

  /**
   * Updates friend profile denormalization in the friends subcollections
   */
  async updateFriendProfileDenormalization(userId: string, newProfile: CreatorProfile): Promise<number> {
    logger.info(`Updating friend profile denormalization for user ${userId}`);

    let totalUpdates = 0;

    try {
      // Get list of friends for this user
      const friendIds = await this.friendshipDAO.getFriendIds(userId);

      if (friendIds.length === 0) {
        logger.info(`User ${userId} has no friends to update`);
        return 0;
      }

      const batch = getFirestore().batch();

      // Update this user's profile data in each friend's FRIENDS subcollection
      for (const friendId of friendIds) {
        await this.friendshipDAO.updateFriendProfile(friendId, userId, newProfile, batch);
        totalUpdates++;
      }

      await batch.commit();
      logger.info(`Updated ${totalUpdates} friend profile references for user ${userId}`);
      return totalUpdates;
    } catch (error) {
      logger.error(`Error updating friend profile denormalization for user ${userId}:`, error);
      throw error;
    }
  }
}
