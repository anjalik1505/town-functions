import path from 'path';
import { fileURLToPath } from 'url';
import { FeedDAO } from '../dao/feed-dao.js';
import { FriendshipDAO } from '../dao/friendship-dao.js';
import { ProfileDAO } from '../dao/profile-dao.js';
import { UpdateDAO } from '../dao/update-dao.js';
import { ApiResponse, EventName, FeedViewEventParams, UpdateViewEventParams } from '../models/analytics-events.js';
import { EnrichedUpdate, FeedResponse, PaginationPayload, Update, UpdatesResponse } from '../models/data-models.js';
import { FeedDoc, UpdateDoc } from '../models/firestore/index.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Service layer for feed and update querying operations
 * Handles read-only operations for retrieving and formatting feed data
 * Separated from UpdateService to focus on query operations
 */
export class FeedQueryService {
  private feedDAO: FeedDAO;
  private updateDAO: UpdateDAO;
  private profileDAO: ProfileDAO;
  private friendshipDAO: FriendshipDAO;

  constructor() {
    this.feedDAO = new FeedDAO();
    this.updateDAO = new UpdateDAO();
    this.profileDAO = new ProfileDAO();
    this.friendshipDAO = new FriendshipDAO();
  }

  /**
   * Retrieves the current user's updates in a paginated format.
   * Queries the user's feed collection filtered by their own created updates.
   * @param userId The ID of the user whose updates to retrieve
   * @param pagination Pagination parameters for the query
   * @returns Paginated list of user's own updates
   */
  async getMyUpdates(userId: string, pagination: PaginationPayload): Promise<ApiResponse<UpdatesResponse>> {
    logger.info(`Retrieving updates for user: ${userId}`);

    // Get pagination parameters
    const limit = pagination?.limit || 20;
    const afterCursor = pagination?.after_cursor;

    logger.info(`Pagination parameters - limit: ${limit}, after_cursor: ${afterCursor}`);

    // Get the user's profile first to verify existence
    const profile = await this.profileDAO.get(userId);
    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    // Get the paginated feed results from DAO
    const { feedItems: feedDocs, nextCursor } = await this.feedDAO.getOwnFeed(userId, afterCursor, limit);

    if (feedDocs.length === 0) {
      logger.info(`No updates found for user ${userId}`);
      const emptyEvent: UpdateViewEventParams = {
        update_count: 0,
        user: userId,
      };
      return {
        data: { updates: [], next_cursor: null },
        status: 200,
        analytics: {
          event: EventName.UPDATES_VIEWED,
          userId: userId,
          params: emptyEvent,
        },
      };
    }

    // Get all update IDs from feed items
    const updateIds = feedDocs.map((doc) => doc.update_id);

    // Batch fetch all updates
    const updateMap = await this.updateDAO.getAll(updateIds);

    // Process feed items using the service's internal processing method
    const updates = await this.processFeedItems(feedDocs, updateMap);

    // nextCursor is already provided by the DAO

    logger.info(`Retrieved ${updates.length} updates for user ${userId}`);
    const event: UpdateViewEventParams = {
      update_count: updates.length,
      user: userId,
    };

    return {
      data: { updates, next_cursor: nextCursor },
      status: 200,
      analytics: {
        event: EventName.UPDATES_VIEWED,
        userId: userId,
        params: event,
      },
    };
  }

  /**
   * Retrieves the user's feed of updates from all sources.
   * Returns enriched updates with creator profile information.
   * @param userId The ID of the user whose feed to retrieve
   * @param pagination Pagination parameters for the query
   * @returns Paginated list of enriched updates from friends and groups
   */
  async getUserFeed(userId: string, pagination: PaginationPayload): Promise<ApiResponse<FeedResponse>> {
    logger.info(`Retrieving feed for user: ${userId}`);

    // Get pagination parameters
    const limit = pagination?.limit || 20;
    const afterCursor = pagination?.after_cursor;

    logger.info(`Pagination parameters - limit: ${limit}, after_cursor: ${afterCursor}`);

    // Get the user's profile first to verify existence
    const profile = await this.profileDAO.get(userId);
    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    // Get the paginated feed results from DAO
    const { feedItems: feedDocs, nextCursor } = await this.feedDAO.getFullFeed(userId, afterCursor, limit);

    if (feedDocs.length === 0) {
      logger.info(`No feed items found for user ${userId}`);
      const emptyEvent: FeedViewEventParams = {
        update_count: 0,
        unique_creators: 0,
      };
      return {
        data: { updates: [], next_cursor: null },
        status: 200,
        analytics: {
          event: EventName.FEED_VIEWED,
          userId: userId,
          params: emptyEvent,
        },
      };
    }

    // Get all update IDs from feed items
    const updateIds = feedDocs.map((doc) => doc.update_id);

    // Batch fetch all updates
    const updateMap = await this.updateDAO.getAll(updateIds);

    // Get unique user IDs from the updates
    const uniqueUserIds = Array.from(new Set(feedDocs.map((doc) => doc.created_by)));

    // Process feed items using the service's internal processing method
    const enrichedUpdates = await this.processEnrichedFeedItems(feedDocs, updateMap);

    // nextCursor is already provided by the DAO

    logger.info(`Retrieved ${enrichedUpdates.length} updates for user ${userId}`);
    const event: FeedViewEventParams = {
      update_count: enrichedUpdates.length,
      unique_creators: uniqueUserIds.length,
    };

    return {
      data: { updates: enrichedUpdates, next_cursor: nextCursor },
      status: 200,
      analytics: {
        event: EventName.FEED_VIEWED,
        userId: userId,
        params: event,
      },
    };
  }

  /**
   * Retrieves updates for a specific user (friend).
   * Validates friendship and returns updates visible to the current user.
   * @param currentUserId The ID of the user requesting the updates
   * @param targetUserId The ID of the user whose updates to retrieve
   * @param pagination Pagination parameters for the query
   * @returns Paginated list of target user's updates visible to current user
   */
  async getUserUpdates(
    currentUserId: string,
    targetUserId: string,
    pagination: PaginationPayload,
  ): Promise<ApiResponse<UpdatesResponse>> {
    logger.info(`Retrieving updates for user ${targetUserId} requested by ${currentUserId}`);

    // Redirect users to the appropriate endpoint for their own updates
    if (currentUserId === targetUserId) {
      logger.warn(`User ${currentUserId} attempted to view their own updates through /user endpoint`);
      throw new BadRequestError('Use /me/updates endpoint to view your own updates');
    }

    // Get pagination parameters
    const limit = pagination?.limit || 20;
    const afterCursor = pagination?.after_cursor;

    logger.info(`Pagination parameters - limit: ${limit}, after_cursor: ${afterCursor}`);

    // Get the target user's profile
    const targetProfile = await this.profileDAO.get(targetUserId);
    if (!targetProfile) {
      throw new NotFoundError('Profile not found');
    }

    // Get the current user's profile
    const currentProfile = await this.profileDAO.get(currentUserId);
    if (!currentProfile) {
      throw new NotFoundError('Profile not found');
    }

    // Check if users are friends
    const areFriends = await this.friendshipDAO.areFriends(currentUserId, targetUserId);

    // If they are not friends, return an error
    if (!areFriends) {
      logger.warn(`User ${currentUserId} attempted to view updates of non-friend ${targetUserId}`);
      throw new ForbiddenError('You must be friends with this user to view their updates');
    }

    logger.info(`Friendship verified between ${currentUserId} and ${targetUserId}`);

    // Get the paginated feed results from DAO
    const { feedItems: feedDocs, nextCursor } = await this.feedDAO.getFriendFeed(
      currentUserId,
      targetUserId,
      afterCursor,
      limit,
    );

    if (feedDocs.length === 0) {
      logger.info(`No updates found for user ${targetUserId}`);
      const emptyEvent: UpdateViewEventParams = {
        update_count: 0,
        user: targetUserId,
      };
      return {
        data: { updates: [], next_cursor: null },
        status: 200,
        analytics: {
          event: EventName.FRIEND_UPDATES_VIEWED,
          userId: currentUserId,
          params: emptyEvent,
        },
      };
    }

    // Get all update IDs from feed items
    const updateIds = feedDocs.map((doc) => doc.update_id);

    // Batch fetch all updates
    const updateMap = await this.updateDAO.getAll(updateIds);

    // Process feed items using the service's internal processing method
    const updates = await this.processFeedItems(feedDocs, updateMap);

    // nextCursor is already provided by the DAO

    logger.info(`Retrieved ${updates.length} updates for user ${targetUserId}`);
    const event: UpdateViewEventParams = {
      update_count: updates.length,
      user: targetUserId,
    };

    return {
      data: { updates, next_cursor: nextCursor },
      status: 200,
      analytics: {
        event: EventName.FRIEND_UPDATES_VIEWED,
        userId: currentUserId,
        params: event,
      },
    };
  }

  /**
   * Process feed items and create update objects with shared_with data
   * @param feedDocs Array of feed document snapshots
   * @param updateMap Map of update IDs to update data
   * @returns Array of formatted Update objects
   */
  private async processFeedItems(feedDocs: FeedDoc[], updateMap: Map<string, UpdateDoc>): Promise<Update[]> {
    const updates = feedDocs.map((feedData) => {
      const updateId = feedData.update_id;
      const updateData = updateMap.get(updateId);

      if (!updateData) {
        logger.warn(`Missing update data for feed item ${updateId}`);
        return null;
      }

      return FeedQueryService.formatUpdate({
        ...updateData,
        id: updateId,
      } as UpdateDoc);
    });

    return updates.filter((update): update is Update => update !== null);
  }

  /**
   * Process feed items and create enriched update objects with user profile information and shared_with data
   * @param feedDocs Array of feed document snapshots
   * @param updateMap Map of update IDs to update data
   * @returns Array of formatted EnrichedUpdate objects
   */
  private async processEnrichedFeedItems(
    feedDocs: FeedDoc[],
    updateMap: Map<string, UpdateDoc>,
  ): Promise<EnrichedUpdate[]> {
    const updates = feedDocs.map((feedData) => {
      const updateId = feedData.update_id;
      const updateData = updateMap.get(updateId);

      if (!updateData) {
        logger.warn(`Missing update data for feed item ${updateId}`);
        return null;
      }

      return FeedQueryService.formatEnrichedUpdate({
        ...updateData,
        id: updateId,
      } as UpdateDoc);
    });

    return updates.filter((update): update is EnrichedUpdate => update !== null);
  }

  /**
   * Formats an UpdateDoc to Update model
   * @param updateData The update document data
   * @returns Formatted Update
   */
  static formatUpdate(updateData: UpdateDoc): Update {
    return {
      update_id: updateData.id,
      created_by: updateData.created_by,
      content: updateData.content || '',
      group_ids: updateData.group_ids || [],
      friend_ids: updateData.friend_ids || [],
      sentiment: updateData.sentiment || '',
      score: updateData.score || 3,
      emoji: updateData.emoji || '😊',
      created_at: formatTimestamp(updateData.created_at),
      comment_count: updateData.comment_count || 0,
      reaction_count: updateData.reaction_count || 0,
      reactions: Object.entries(updateData.reaction_types || {})
        .map(([type, count]) => ({ type, count: count as number }))
        .filter((r) => r.count > 0),
      all_village: updateData.all_village || false,
      images: updateData.image_paths || [],
      shared_with_friends: (updateData.shared_with_friends_profiles || []).map((p) => ({
        user_id: p.user_id,
        username: p.username,
        name: p.name,
        avatar: p.avatar,
      })),
      shared_with_groups: (updateData.shared_with_groups_profiles || []).map((g) => ({
        group_id: g.group_id,
        name: g.name,
        icon: g.icon,
      })),
    };
  }

  /**
   * Formats an UpdateDoc to EnrichedUpdate model
   * @param updateData The update document data
   * @returns Formatted EnrichedUpdate
   */
  static formatEnrichedUpdate(updateData: UpdateDoc): EnrichedUpdate {
    const update = FeedQueryService.formatUpdate(updateData);
    const creatorProfile = updateData.creator_profile || { username: '', name: '', avatar: '' };

    return {
      ...update,
      username: creatorProfile.username,
      name: creatorProfile.name,
      avatar: creatorProfile.avatar,
    };
  }
}
