import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeImagesFlow } from '../ai/flows.js';
import { DeviceDAO } from '../dao/device-dao.js';
import { FeedDAO } from '../dao/feed-dao.js';
import { FriendshipDAO } from '../dao/friendship-dao.js';
import { ProfileDAO } from '../dao/profile-dao.js';
import { UpdateDAO } from '../dao/update-dao.js';
import { UserSummaryDAO } from '../dao/user-summary-dao.js';
import { EventName, FriendshipAcceptanceEventParams, FriendSummaryEventParams } from '../models/analytics-events.js';
import { MAX_BATCH_OPERATIONS, NotificationTypes } from '../models/constants.js';
import { ProfileData, SummaryContext, SummaryResult } from '../models/data-models.js';
import { ProfileDoc } from '../models/firestore/profile-doc.js';
import { UpdateDoc, UserProfile } from '../models/firestore/update-doc.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { processImagesForPrompt } from '../utils/image-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { sendNotification } from '../utils/notification-utils.js';
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
  private deviceDAO: DeviceDAO;
  private db = getFirestore();

  constructor() {
    this.friendshipDAO = new FriendshipDAO();
    this.profileDAO = new ProfileDAO();
    this.updateDAO = new UpdateDAO();
    this.feedDAO = new FeedDAO();
    this.userSummaryDAO = new UserSummaryDAO();
    this.deviceDAO = new DeviceDAO();
  }

  /**
   * Processes a new friendship creation
   * Syncs updates between friends and sends notifications if needed
   */
  async processFriendshipCreation(userId: string, friendId: string, accepterId?: string): Promise<void> {
    logger.info(`Processing friendship creation between ${userId} and ${friendId}`);

    try {
      // Fetch both profiles once at the beginning
      const [userProfile, friendProfile] = await Promise.all([
        this.profileDAO.findById(userId),
        this.profileDAO.findById(friendId),
      ]);

      if (!userProfile || !friendProfile) {
        logger.error(`Missing profile data: user=${!!userProfile}, friend=${!!friendProfile}`);
        return;
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
        await this.friendshipDAO.upsertFriend(
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
        await this.friendshipDAO.upsertFriend(
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

      // Handle join request acceptance notifications
      if (accepterId) {
        const accepterProfile = accepterId === userId ? userProfile : friendProfile;
        await this.sendAcceptanceNotification(userId, friendId, accepterId, accepterProfile);
      }
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
      for await (const update of this.updateDAO.streamAllVillageUpdatesByUser(sourceUserId)) {
        // Capture first (latest) update info
        if (!latestInfo) {
          latestInfo = { emoji: update.emoji || '', updatedAt: update.created_at };
        }

        // Keep last 10 for summaries
        if (lastUpdates.length < 10) {
          lastUpdates.push(update);
        }

        // Create feed item
        await this.feedDAO.createFeedItems(
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
          await this.updateDAO.shareUpdate(
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
      // Process images
      const imagePaths = updateData.image_paths || [];
      const processedImages = await processImagesForPrompt(imagePaths);

      // Analyze images
      const { analysis: imageAnalysis } = await analyzeImagesFlow({ images: processedImages });

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
    const existingSummaryDoc = await this.userSummaryDAO.getById(summaryId);

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
   * Sends friendship acceptance notification
   */
  private async sendAcceptanceNotification(
    userId: string,
    friendId: string,
    accepterId: string,
    accepterProfile: ProfileDoc,
  ): Promise<void> {
    const requesterId = accepterId === userId ? friendId : userId;

    logger.info(`Handling join request acceptance: requester=${requesterId}, accepter=${accepterId}`);

    try {
      // Get device using DeviceDAO
      const deviceData = await this.deviceDAO.findById(requesterId);

      if (deviceData && deviceData.device_id) {
        const accepterName = accepterProfile.name || accepterProfile.username || 'Friend';
        const message = `${accepterName} accepted your request!`;

        await sendNotification(deviceData.device_id, 'New Friend!', message, {
          type: NotificationTypes.FRIENDSHIP,
        });

        logger.info(`Sent friendship acceptance notification to requester ${requesterId}`);
        this.trackAcceptanceEvent(true, requesterId);
      } else {
        logger.info(`No device found for requester ${requesterId}, skipping notification`);
        this.trackAcceptanceEvent(false, requesterId);
      }
    } catch (error) {
      logger.error(`Error sending friendship acceptance notification to requester ${requesterId}: ${error}`);
      // Continue execution even if notification fails
    }
  }

  /**
   * Tracks friendship acceptance analytics event
   */
  private trackAcceptanceEvent(hasDevice: boolean, senderId: string): void {
    const friendshipEvent: FriendshipAcceptanceEventParams = {
      sender_has_name: true, // We'll assume profiles exist at this point
      sender_has_avatar: true,
      receiver_has_name: true,
      receiver_has_avatar: true,
      has_device: hasDevice,
    };

    trackApiEvents(
      [
        {
          eventName: EventName.FRIENDSHIP_ACCEPTED,
          params: friendshipEvent,
        },
      ],
      senderId,
    );
  }
}
