import { getFirestore, Timestamp, WriteBatch } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateNotificationMessageFlow } from '../ai/flows.js';
import { CommentDAO } from '../dao/comment-dao.js';
import { FeedDAO } from '../dao/feed-dao.js';
import { FriendshipDAO } from '../dao/friendship-dao.js';
import { GroupDAO } from '../dao/group-dao.js';
import { ProfileDAO } from '../dao/profile-dao.js';
import { ReactionDAO } from '../dao/reaction-dao.js';
import { StorageDAO } from '../dao/storage-dao.js';
import { UpdateDAO } from '../dao/update-dao.js';
import { ApiResponse, EventName, FeedViewEventParams, UpdateViewEventParams } from '../models/analytics-events.js';
import { NotificationTypes } from '../models/constants.js';
import {
  Comment,
  CommentsResponse,
  CreateCommentPayload,
  CreateUpdatePayload,
  EnrichedUpdate,
  FeedResponse,
  PaginationPayload,
  ReactionGroup,
  ShareUpdatePayload,
  Update,
  UpdateCommentPayload,
  UpdatesResponse,
  UpdateWithCommentsResponse,
} from '../models/data-models.js';
import {
  CommentDoc,
  FeedDoc,
  GroupProfile,
  NotificationSettings,
  ReactionDoc,
  SimpleProfile,
  UpdateDoc,
  UserProfile,
} from '../models/firestore/index.js';
import { commitBatch, commitFinal } from '../utils/batch-utils.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { calculateAge } from '../utils/profile-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';
import { createFriendVisibilityIdentifier } from '../utils/visibility-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Service layer for Update operations
 * Handles business logic, validation, and coordination between DAOs
 */
export class UpdateService {
  private updateDAO: UpdateDAO;
  private commentDAO: CommentDAO;
  private reactionDAO: ReactionDAO;
  private feedDAO: FeedDAO;
  private profileDAO: ProfileDAO;
  private groupDAO: GroupDAO;
  private friendshipDAO: FriendshipDAO;
  private storageDAO: StorageDAO;
  private db: FirebaseFirestore.Firestore;

  constructor() {
    this.updateDAO = new UpdateDAO();
    this.commentDAO = new CommentDAO();
    this.reactionDAO = new ReactionDAO();
    this.feedDAO = new FeedDAO();
    this.profileDAO = new ProfileDAO();
    this.groupDAO = new GroupDAO();
    this.friendshipDAO = new FriendshipDAO();
    this.storageDAO = new StorageDAO();
    this.db = getFirestore();
  }

  /**
   * Creates a new update with complex feed fanout and image processing
   * @param userId The ID of the user creating the update
   * @param data The update creation payload
   * @returns The created update
   */
  async createUpdate(userId: string, data: CreateUpdatePayload): Promise<ApiResponse<Update>> {
    logger.info(`Creating update for user: ${userId}`);

    const content = data.content || '';
    const sentiment = data.sentiment || '';
    const score = data.score || 3;
    const emoji = data.emoji || '😊';
    const allVillage = data.all_village || false;
    let groupIds = data.group_ids || [];
    let friendIds = data.friend_ids || [];
    const images = data.images || [];

    logger.info(
      `Update details - content length: ${content.length}, ` +
        `sentiment: ${sentiment}, score: ${score}, emoji: ${emoji}, ` +
        `all_village: ${allVillage}, ` +
        `shared with ${friendIds.length} friends and ${groupIds.length} groups, ` +
        `${images.length} images`,
    );

    // Get creator's profile for denormalization
    const SimpleProfile = await this.profileDAO.get(userId);
    if (!SimpleProfile) {
      throw new NotFoundError('Creator profile not found');
    }

    // If allVillage is true, get all friends and groups of the user
    if (allVillage) {
      logger.info(`All village mode enabled, fetching all friends and groups for user: ${userId}`);

      // Get all friends using FriendshipDAO
      const tmpFriendIds = await this.friendshipDAO.getFriendIds(userId);

      // Get all groups where the user is a member
      const userGroups = await this.groupDAO.getForUser(userId);
      const tmpGroupIds = userGroups.map((group) => group.group_id);

      logger.info(`All village mode: found ${tmpFriendIds.length} friends and ${tmpGroupIds.length} groups`);

      // Deduplicate IDs
      friendIds = [...new Set([...friendIds, ...tmpFriendIds])];
      groupIds = [...new Set([...groupIds, ...tmpGroupIds])];
    }

    const SimpleProfileData: SimpleProfile = {
      username: SimpleProfile.username,
      name: SimpleProfile.name,
      avatar: SimpleProfile.avatar,
    };

    const updateId = await this.updateDAO.createId();

    // Process images - move from staging to final location
    const finalImagePaths = await this.storageDAO.copyImages(images, userId, updateId);

    // Fetch profiles for friends and groups for denormalization
    let sharedWithFriendsProfiles: UserProfile[] = [];
    let sharedWithGroupsProfiles: GroupProfile[] = [];

    if (friendIds.length > 0) {
      const friendProfiles = await this.profileDAO.getAll(friendIds);
      sharedWithFriendsProfiles = friendProfiles.map((profile) => ({
        user_id: profile.user_id,
        username: profile.username,
        name: profile.name,
        avatar: profile.avatar,
      }));
    }

    if (groupIds.length > 0) {
      const groups = await this.groupDAO.getGroups(groupIds);
      sharedWithGroupsProfiles = groups.map((group) => ({
        group_id: group.id,
        name: group.name,
        icon: group.icon || '',
      }));
    }

    // Create the update with denormalization
    const createdAt = Timestamp.now();
    const updateData: Omit<
      UpdateDoc,
      'id' | 'creator_profile' | 'shared_with_friends_profiles' | 'shared_with_groups_profiles'
    > = {
      created_by: userId,
      content,
      sentiment,
      score,
      emoji,
      created_at: createdAt,
      group_ids: groupIds,
      friend_ids: friendIds,
      visible_to: [], // Will be set by DAO
      all_village: allVillage,
      image_paths: finalImagePaths,
      comment_count: 0,
      reaction_count: 0,
      reaction_types: {},
    };

    // Create a batch for atomic operations
    const batch = this.db.batch();

    // Create the update within the batch
    const createResult = await this.updateDAO.create(
      updateId,
      updateData,
      SimpleProfileData,
      friendIds,
      groupIds,
      sharedWithFriendsProfiles,
      sharedWithGroupsProfiles,
      batch,
    );

    // Create feed fanout within the same batch
    await this.createFeedFanout(updateId, userId, createdAt, friendIds, groupIds, true, batch);

    // Commit the batch
    await batch.commit();

    // Return the created update
    return {
      data: this.formatUpdate(createResult.data),
      status: 201,
      analytics: {
        event: EventName.UPDATE_CREATED,
        userId: userId,
        params: {
          content_length: content.length,
          sentiment,
          score,
          friend_count: friendIds.length,
          group_count: groupIds.length,
          all_village: allVillage,
          image_count: finalImagePaths.length,
        },
      },
    };
  }

  /**
   * Gets an update with access control and enrichment
   * @param userId The ID of the user requesting the update
   * @param updateId The ID of the update to retrieve
   * @param pagination Pagination parameters
   * @returns The enriched update with paginated comments
   */
  async getUpdate(
    userId: string,
    updateId: string,
    pagination: PaginationPayload,
  ): Promise<ApiResponse<UpdateWithCommentsResponse>> {
    logger.info(`Getting update ${updateId} for user ${userId}`);

    const limit = pagination?.limit || 20;
    const afterCursor = pagination?.after_cursor;

    const result = await this.updateDAO.get(updateId, userId);
    if (!result) {
      throw new NotFoundError('Update not found');
    }

    const updateData = result.data;

    // Format as enriched update
    const enrichedUpdate = this.formatEnrichedUpdate(updateData);

    // Fetch comments for the update with pagination
    const { comments, nextCursor } = await this.commentDAO.getComments(result.ref, limit, afterCursor);

    // Format comments
    const formattedComments = comments.map((c) => this.formatComment(c));

    return {
      data: {
        update: enrichedUpdate,
        comments: formattedComments,
        next_cursor: nextCursor,
      },
      status: 200,
      analytics: {
        event: EventName.UPDATE_VIEWED,
        userId: userId,
        params: {
          update_id: updateId,
          comment_count: updateData.comment_count,
          reaction_count: updateData.reaction_count,
        },
      },
    };
  }

  /**
   * Shares an update with additional friends and groups
   * @param userId The ID of the user sharing the update
   * @param updateId The ID of the update to share
   * @param shareData The share payload
   * @returns The updated update
   */
  async shareUpdate(userId: string, updateId: string, shareData: ShareUpdatePayload): Promise<ApiResponse<Update>> {
    logger.info(`Sharing update ${updateId} by user ${userId}`);

    const result = await this.updateDAO.get(updateId);
    if (!result) {
      throw new NotFoundError('Update not found');
    }

    const updateData = result.data;

    // Check if user is the creator
    if (updateData.created_by !== userId) {
      throw new ForbiddenError('You can only share your own updates');
    }

    const newFriendIds = shareData.friend_ids || [];
    const newGroupIds = shareData.group_ids || [];

    // Filter out already shared friends and groups
    const additionalFriendIds = newFriendIds.filter((id: string) => !updateData.friend_ids.includes(id));
    const additionalGroupIds = newGroupIds.filter((id: string) => !updateData.group_ids.includes(id));

    if (additionalFriendIds.length === 0 && additionalGroupIds.length === 0) {
      logger.info('No new recipients to share with');
      return {
        data: this.formatUpdate(updateData),
        status: 200,
        analytics: {
          event: EventName.UPDATE_SHARED,
          userId: userId,
          params: {
            new_friends_count: 0,
            total_friends_count: updateData.friend_ids.length,
            new_groups_count: 0,
            total_groups_count: updateData.group_ids.length,
          },
        },
      };
    }

    // Fetch profiles for new recipients
    let additionalFriendsProfiles: UserProfile[] = [];
    let additionalGroupsProfiles: GroupProfile[] = [];

    if (additionalFriendIds.length > 0) {
      const friendProfiles = await this.profileDAO.getAll(additionalFriendIds);
      additionalFriendsProfiles = friendProfiles.map((profile) => ({
        user_id: profile.user_id,
        username: profile.username,
        name: profile.name,
        avatar: profile.avatar,
      }));
    }

    if (additionalGroupIds.length > 0) {
      const groups = await this.groupDAO.getGroups(additionalGroupIds);
      additionalGroupsProfiles = groups.map((group) => ({
        group_id: group.id,
        name: group.name,
        icon: group.icon || '',
      }));
    }

    // Create a batch for atomic operations
    const batch = this.db.batch();

    // Update the update document within the batch
    const updatedData = await this.updateDAO.share(
      updateId,
      additionalFriendIds,
      additionalGroupIds,
      additionalFriendsProfiles,
      additionalGroupsProfiles,
      batch,
    );

    // Create additional feed items for new recipients within the same batch
    await this.createFeedFanout(
      updateId,
      userId,
      updateData.created_at,
      additionalFriendIds,
      additionalGroupIds,
      false,
      batch,
    );

    // Commit the batch
    await batch.commit();

    return {
      data: this.formatUpdate(updatedData),
      status: 200,
      analytics: {
        event: EventName.UPDATE_SHARED,
        userId: userId,
        params: {
          new_friends_count: additionalFriendIds.length,
          total_friends_count: updatedData.friend_ids.length,
          new_groups_count: additionalGroupIds.length,
          total_groups_count: updatedData.group_ids.length,
        },
      },
    };
  }

  /**
   * Creates a comment on an update
   * @param userId The ID of the user creating the comment
   * @param updateId The ID of the update to comment on
   * @param data The comment creation payload
   * @returns The created comment
   */
  async createComment(userId: string, updateId: string, data: CreateCommentPayload): Promise<ApiResponse<Comment>> {
    logger.info(`Creating comment on update ${updateId} by user ${userId}`);

    const result = await this.updateDAO.get(updateId);
    if (!result) {
      throw new NotFoundError('Update not found');
    }

    // Check access
    await this.checkUpdateAccess(result.data, userId);

    // Get creator's profile for denormalization
    const SimpleProfile = await this.profileDAO.get(userId);
    if (!SimpleProfile) {
      throw new NotFoundError('Creator profile not found');
    }

    const commenterProfile: SimpleProfile = {
      username: SimpleProfile.username,
      name: SimpleProfile.name,
      avatar: SimpleProfile.avatar,
    };

    const commentData = {
      created_by: userId,
      content: data.content,
      created_at: Timestamp.now(),
      updated_at: Timestamp.now(),
      parent_id: data.parent_id || null,
      commenter_profile: commenterProfile,
    };

    // Create batch for atomic operation
    const batch = this.db.batch();

    const { data: createdComment } = await this.commentDAO.create(result.ref, commentData, batch);

    // Update comment count on the update document
    this.updateDAO.incrementCommentCount(updateId, batch);

    // Commit the batch
    await batch.commit();

    return {
      data: this.formatComment(createdComment),
      status: 201,
      analytics: {
        event: EventName.COMMENT_CREATED,
        userId: userId,
        params: {
          comment_length: data.content.length,
          comment_count: result.data.comment_count + 1,
          reaction_count: result.data.reaction_count,
        },
      },
    };
  }

  /**
   * Updates a comment
   * @param userId The ID of the user updating the comment
   * @param updateId The ID of the update containing the comment
   * @param commentId The ID of the comment to update
   * @param data The comment update payload
   * @returns The updated comment
   */
  async updateComment(
    userId: string,
    updateId: string,
    commentId: string,
    data: UpdateCommentPayload,
  ): Promise<ApiResponse<Comment>> {
    logger.info(`Updating comment ${commentId} on update ${updateId} by user ${userId}`);

    if (!updateId) {
      throw new BadRequestError('Update ID is required');
    }

    if (!commentId) {
      throw new BadRequestError('Comment ID is required');
    }

    const result = await this.updateDAO.get(updateId);
    if (!result) {
      throw new NotFoundError('Update not found');
    }

    const updatedComment = await this.commentDAO.update(result.ref, commentId, data.content, userId);

    return {
      data: this.formatComment(updatedComment),
      status: 200,
      analytics: {
        event: EventName.COMMENT_UPDATED,
        userId: userId,
        params: {
          comment_length: data.content.length,
          comment_count: result.data.comment_count,
          reaction_count: result.data.reaction_count,
        },
      },
    };
  }

  /**
   * Deletes a comment
   * @param userId The ID of the user deleting the comment
   * @param updateId The ID of the update containing the comment
   * @param commentId The ID of the comment to delete
   */
  async deleteComment(userId: string, updateId: string, commentId: string): Promise<ApiResponse<null>> {
    logger.info(`Deleting comment ${commentId} on update ${updateId} by user ${userId}`);

    if (!updateId) {
      throw new BadRequestError('Update ID is required');
    }

    if (!commentId) {
      throw new BadRequestError('Comment ID is required');
    }

    const result = await this.updateDAO.get(updateId);
    if (!result) {
      throw new NotFoundError('Update not found');
    }

    // Create batch for atomic operation
    const batch = this.db.batch();

    await this.commentDAO.delete(result.ref, commentId, userId, batch);

    // Update comment count on the update document
    this.updateDAO.decrementCommentCount(updateId, batch);

    // Commit the batch
    await batch.commit();

    return {
      data: null,
      status: 200,
      analytics: {
        event: EventName.COMMENT_DELETED,
        userId: userId,
        params: {
          comment_length: 0,
          comment_count: Math.max(0, result.data.comment_count - 1),
          reaction_count: result.data.reaction_count,
        },
      },
    };
  }

  /**
   * Adds a reaction to an update
   * @param userId The ID of the user adding the reaction
   * @param updateId The ID of the update to react to
   * @param type The reaction type
   * @returns The user's current reaction types
   */
  async addReaction(userId: string, updateId: string, type: string): Promise<ApiResponse<ReactionGroup>> {
    logger.info(`Adding reaction ${type} to update ${updateId} by user ${userId}`);

    const result = await this.updateDAO.get(updateId);
    if (!result) {
      throw new NotFoundError('Update not found');
    }

    // Check access
    await this.checkUpdateAccess(result.data, userId);

    // Create batch for atomic operation
    const batch = this.db.batch();

    await this.reactionDAO.upsert(result.ref, userId, type, batch);

    // Update reaction counts on the update document
    this.updateDAO.incrementReactionCount(updateId, type, batch);

    // Commit the batch
    await batch.commit();

    // The upsertReaction method already incremented the counter, so we add 1 to get the new count
    const previousCount = result.data.reaction_types?.[type] || 0;
    const newCount = previousCount + 1;

    return {
      data: {
        type: type,
        count: newCount,
      },
      status: 200,
      analytics: {
        event: EventName.REACTION_CREATED,
        userId: userId,
        params: {
          reaction_count: result.data.reaction_count + 1,
          comment_count: result.data.comment_count,
        },
      },
    };
  }

  /**
   * Removes a specific reaction type from an update
   * @param userId The ID of the user removing the reaction
   * @param updateId The ID of the update to remove reaction from
   * @param type The reaction type to remove
   * @returns The reaction group with updated count
   */
  async removeReaction(userId: string, updateId: string, type: string): Promise<ApiResponse<ReactionGroup>> {
    logger.info(`Removing reaction type ${type} from update ${updateId} by user ${userId}`);

    const result = await this.updateDAO.get(updateId);
    if (!result) {
      throw new NotFoundError('Update not found');
    }

    // Check access
    await this.checkUpdateAccess(result.data, userId);

    // Create batch for atomic operation
    const batch = this.db.batch();

    // Remove only the specific reaction type
    await this.reactionDAO.delete(result.ref, userId, type, batch);

    // Update reaction counts on the update document
    this.updateDAO.decrementReactionCount(updateId, type, batch);

    // Commit the batch
    await batch.commit();

    // Get current count for this type from denormalized data
    const currentTypeCount = result.data.reaction_types?.[type] || 0;
    const newTypeCount = Math.max(0, currentTypeCount - 1);

    return {
      data: {
        type: type,
        count: newTypeCount,
      },
      status: 200,
      analytics: {
        event: EventName.REACTION_DELETED,
        userId: userId,
        params: {
          reaction_count: Math.max(0, result.data.reaction_count - 1),
          comment_count: result.data.comment_count,
        },
      },
    };
  }

  /**
   * Gets comments for an update with access control
   * @param userId The ID of the user requesting comments
   * @param updateId The ID of the update
   * @param pagination Pagination parameters
   * @returns Paginated comments
   */
  async getComments(
    userId: string,
    updateId: string,
    pagination: PaginationPayload,
  ): Promise<ApiResponse<CommentsResponse>> {
    logger.info(`Getting comments for update ${updateId} by user ${userId}`);

    const limit = pagination?.limit || 20;
    const afterCursor = pagination?.after_cursor;

    const result = await this.updateDAO.get(updateId);
    if (!result) {
      throw new NotFoundError('Update not found');
    }

    // Check access
    await this.checkUpdateAccess(result.data, userId);

    const { comments, nextCursor } = await this.commentDAO.getComments(result.ref, limit, afterCursor);

    const formattedComments = comments.map((c) => this.formatComment(c));

    return {
      data: {
        comments: formattedComments,
        next_cursor: nextCursor,
      },
      status: 200,
      analytics: {
        event: EventName.COMMENTS_VIEWED,
        userId: userId,
        params: {
          comment_count: comments.length,
          reaction_count: result.data.reaction_count,
          unique_creators: new Set(comments.map((c) => c.created_by)).size,
        },
      },
    };
  }

  /**
   * Retrieves the current user's updates in a paginated format.
   * Queries the user's feed collection filtered by their own created updates.
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
   * Creates feed fanout for an update
   * @param updateId The update ID
   * @param createdBy The creator user ID
   * @param createdAt The creation timestamp
   * @param friendIds Friend IDs to share with
   * @param groupIds Group IDs to share with
   * @param batch Optional WriteBatch to add operations to (won't commit if provided)
   */
  private async createFeedFanout(
    updateId: string,
    createdBy: string,
    createdAt: Timestamp,
    friendIds: string[],
    groupIds: string[],
    addSelf: boolean,
    batch?: WriteBatch,
  ): Promise<void> {
    const usersToNotify = new Set<string>();

    // Add creator if addSelf is true
    if (addSelf) {
      usersToNotify.add(createdBy);
    }

    friendIds.forEach((friendId) => usersToNotify.add(friendId));

    // Get group members
    const groupMembersMap = new Map<string, Set<string>>();
    if (groupIds.length > 0) {
      const groups = await this.groupDAO.getGroups(groupIds);
      for (const group of groups) {
        const members = new Set(group.members);
        groupMembersMap.set(group.id, members);
        members.forEach((memberId) => usersToNotify.add(memberId));
      }
    }

    // Create feed items (batch will be passed through to FeedDAO)
    await this.feedDAO.createForUpdate(
      usersToNotify,
      updateId,
      createdAt,
      createdBy,
      friendIds,
      groupIds,
      groupMembersMap,
      batch,
    );

    logger.info(`Created feed fanout for ${usersToNotify.size} users`);
  }

  /**
   * Formats an UpdateDoc to Update model
   * @param updateData The update document data
   * @returns Formatted Update
   */
  private formatUpdate(updateData: UpdateDoc): Update {
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
  private formatEnrichedUpdate(updateData: UpdateDoc): EnrichedUpdate {
    const update = this.formatUpdate(updateData);
    const SimpleProfile = updateData.creator_profile || { username: '', name: '', avatar: '' };

    return {
      ...update,
      username: SimpleProfile.username,
      name: SimpleProfile.name,
      avatar: SimpleProfile.avatar,
    };
  }

  /**
   * Formats a CommentDoc to Comment model
   * @param commentData The comment document data
   * @returns Formatted Comment
   */
  private formatComment(commentData: CommentDoc): Comment {
    const commenterProfile = commentData.commenter_profile || { username: '', name: '', avatar: '' };

    return {
      comment_id: commentData.id,
      created_by: commentData.created_by,
      content: commentData.content,
      created_at: formatTimestamp(commentData.created_at),
      updated_at: formatTimestamp(commentData.updated_at),
      username: commenterProfile.username,
      name: commenterProfile.name,
      avatar: commenterProfile.avatar,
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
        return [];
      }

      return this.formatUpdate({
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
        return [];
      }

      return this.formatEnrichedUpdate({
        ...updateData,
        id: updateId,
      } as UpdateDoc);
    });

    return updates.filter((update): update is EnrichedUpdate => update !== null);
  }

  /**
   * Prepares notification data for comment notifications
   * @param updateId The ID of the update that was commented on
   * @param commentData The comment document data
   * @param commenterId The ID of the user who created the comment
   * @returns Object containing notification data for different recipient types
   */
  async prepareCommentNotifications(
    updateId: string,
    commentData: CommentDoc,
    commenterId: string,
  ): Promise<{
    updateCreatorNotification?: {
      userId: string;
      title: string;
      message: string;
      data: { type: string; update_id: string };
    };
    participantNotifications?: {
      userIds: string[];
      title: string;
      message: string;
      data: { type: string; update_id: string };
    };
  }> {
    logger.info(`Preparing comment notifications for update ${updateId} by commenter ${commenterId}`);

    // Fetch the update using UpdateDAO
    const update = await this.updateDAO.get(updateId);

    if (!update || !update.data) {
      logger.warn(`Update not found for ID ${updateId}`);
      return {};
    }

    const updateCreatorId = update.data.created_by;

    // Build a set of all participants: update creator + every previous commenter
    const participantIds = new Set<string>();
    if (updateCreatorId) {
      participantIds.add(updateCreatorId);
    }

    // Get all comments using pagination to find all participants
    try {
      let cursor: string | null = null;

      do {
        const { comments, nextCursor } = await this.commentDAO.getComments(update.ref, 250, cursor || undefined);

        for (const comment of comments) {
          const createdBy = comment.created_by;
          if (createdBy) {
            participantIds.add(createdBy);
          }
        }

        cursor = nextCursor;
      } while (cursor);
    } catch (error) {
      logger.error(`Failed to fetch comments for update ${updateId}`, error);
    }

    // Exclude the author of the new comment
    participantIds.delete(commenterId);

    // Get commenter profile from denormalized data
    const commenterProfile = commentData.commenter_profile;
    const commenterName = commenterProfile.name || commenterProfile.username || 'Friend';

    // Prepare comment snippet
    const commentContent = commentData.content || '';
    const truncatedComment = commentContent.length > 50 ? `${commentContent.substring(0, 47)}...` : commentContent;

    // Prepare notification data
    let updateCreatorNotification:
      | {
          userId: string;
          title: string;
          message: string;
          data: { type: string; update_id: string };
        }
      | undefined;

    const otherParticipantIds: string[] = [];

    for (const targetUserId of participantIds) {
      if (targetUserId === updateCreatorId) {
        updateCreatorNotification = {
          userId: targetUserId,
          title: 'New Comment',
          message: `${commenterName} commented on your post: "${truncatedComment}"`,
          data: {
            type: NotificationTypes.COMMENT,
            update_id: updateId,
          },
        };
      } else {
        otherParticipantIds.push(targetUserId);
      }
    }

    const participantNotifications =
      otherParticipantIds.length > 0
        ? {
            userIds: otherParticipantIds,
            title: 'New Comment',
            message: `${commenterName} also commented on a post you're following: "${truncatedComment}"`,
            data: {
              type: NotificationTypes.COMMENT,
              update_id: updateId,
            },
          }
        : undefined;

    logger.info(
      `Prepared comment notifications: ${updateCreatorNotification ? 1 : 0} for creator, ${otherParticipantIds.length} for participants on update ${updateId}`,
    );

    return {
      updateCreatorNotification,
      participantNotifications,
    };
  }

  /**
   * Prepares notification data for reaction notifications
   * @param updateId The ID of the update that was reacted to
   * @param reactionData The reaction document data
   * @param reactorId The ID of the user who created the reaction
   * @returns Object containing notification data for the update creator
   */
  async prepareReactionNotifications(
    updateId: string,
    reactionData: ReactionDoc,
    reactorId: string,
  ): Promise<{
    updateCreatorNotification?: {
      userId: string;
      title: string;
      message: string;
      data: { type: string; update_id: string };
    };
  }> {
    logger.info(`Preparing reaction notifications for update ${updateId} by reactor ${reactorId}`);

    // Fetch the update using UpdateDAO
    const update = await this.updateDAO.get(updateId);

    if (!update || !update.data) {
      logger.warn(`Update not found for ID ${updateId}`);
      return {};
    }

    const updateCreatorId = update.data.created_by;

    // Skip if the reactor is the update creator (self-reaction)
    if (reactorId === updateCreatorId) {
      logger.info(`Skipping notification for update creator: ${updateCreatorId} (self-reaction)`);
      return {};
    }

    // Get reactor profile info to build notification message
    const reactorProfile = await this.profileDAO.get(reactorId);
    if (!reactorProfile) {
      logger.warn(`Reactor profile not found for ID ${reactorId}`);
      return {};
    }

    const reactorName = reactorProfile.name || reactorProfile.username || 'Friend';

    // Get the most recent reaction type (last in the array)
    const reactionTypes = reactionData.types || [];
    const reactionType = reactionTypes.length > 0 ? reactionTypes[reactionTypes.length - 1] : 'like';

    // Prepare notification data for the update creator
    const updateCreatorNotification = {
      userId: updateCreatorId,
      title: 'New Reaction',
      message: `${reactorName} reacted to your update with ${reactionType}`,
      data: {
        type: NotificationTypes.REACTION,
        update_id: updateId,
      },
    };

    logger.info(`Prepared reaction notification for update creator ${updateCreatorId} on update ${updateId}`);

    return {
      updateCreatorNotification,
    };
  }

  /**
   * Prepares notification data for update notifications
   * @param updateData The update document data
   * @returns Object containing notification data for all recipients
   */
  async prepareUpdateNotifications(updateData: UpdateDoc): Promise<{
    notifications?: {
      userIds: string[];
      title: string;
      message: string;
      data: { type: string; update_id: string };
    };
    backgroundNotifications?: {
      userIds: string[];
      data: { type: string; update_id: string };
    };
  }> {
    const creatorId = updateData.created_by;
    const friendIds = updateData.friend_ids || [];
    const groupIds = updateData.group_ids || [];
    const updateId = updateData.id;

    // Prepare notification data
    let notifications:
      | {
          userIds: string[];
          title: string;
          message: string;
          data: { type: string; update_id: string };
        }
      | undefined = undefined;

    let backgroundNotifications:
      | {
          userIds: string[];
          data: { type: string; update_id: string };
        }
      | undefined = undefined;

    if (!creatorId) {
      logger.warn('Update has no creator ID');
      return { notifications, backgroundNotifications };
    }

    // Get the creator's profile information
    const SimpleProfile = await this.profileDAO.get(creatorId);
    let creatorName = 'Friend';
    let creatorGender = 'They';
    let creatorLocation = '';
    let creatorBirthday = '';

    if (SimpleProfile) {
      creatorName = SimpleProfile.name || SimpleProfile.username || 'Friend';
      creatorGender = SimpleProfile.gender || 'They';
      creatorLocation = SimpleProfile.location || '';
      creatorBirthday = SimpleProfile.birthday || '';
    } else {
      logger.warn(`Creator profile not found: ${creatorId}`);
    }

    // Create a set of all users who should receive the update
    const usersToCheck = new Set<string>();
    const groupUsers = new Set<string>();

    // Add all friends
    friendIds.forEach((friendId: string) => usersToCheck.add(friendId));

    // Get all group members if there are groups
    if (groupIds.length > 0) {
      const groups = await this.groupDAO.getGroups(groupIds);
      groups.forEach((group) => {
        if (group.members) {
          group.members.forEach((memberId: string) => {
            usersToCheck.add(memberId);
            groupUsers.add(memberId);
          });
        }
      });
    }

    // Remove the creator from notifications
    usersToCheck.delete(creatorId);

    // Process notifications for all users
    const usersToNotify: string[] = [];

    for (const userId of usersToCheck) {
      const shouldSendNotification = await this.shouldSendNotification(userId, updateData.score);
      if (shouldSendNotification) {
        usersToNotify.push(userId);
      }
    }

    // Add notifications for users who want all updates
    if (usersToNotify.length > 0) {
      const message = await this.generateUpdateNotificationMessage(
        updateData,
        creatorName,
        creatorGender,
        creatorLocation,
        creatorBirthday,
      );

      notifications = {
        userIds: usersToNotify,
        title: 'New Update',
        message: message,
        data: {
          type: NotificationTypes.UPDATE,
          update_id: updateId,
        },
      };

      backgroundNotifications = {
        userIds: usersToNotify,
        data: {
          type: NotificationTypes.UPDATE_BACKGROUND,
          update_id: updateId,
        },
      };
    }

    logger.info(`Prepared update notifications for ${usersToNotify.length} users`);

    return {
      notifications,
      backgroundNotifications,
    };
  }

  /**
   * Updates the image analysis field for an update
   * @param updateId The update ID to update
   * @param imageAnalysis The image analysis text to store
   */
  async updateImageAnalysis(updateId: string, imageAnalysis: string): Promise<void> {
    logger.info(`Updating image analysis for update ${updateId} (${imageAnalysis.length} characters)`);
    await this.updateDAO.updateImageAnalysis(updateId, imageAnalysis);
  }

  /**
   * Updates profile denormalization across all update-related collections
   * Delegates to DAO layers for all database operations
   */
  async updateProfileDenormalization(userId: string, newProfile: SimpleProfile): Promise<number> {
    logger.info(`Updating profile denormalization in updates for user ${userId}`);

    try {
      // Convert to UserProfile for shared friend updates
      const userProfile: UserProfile = {
        user_id: userId,
        username: newProfile.username,
        name: newProfile.name,
        avatar: newProfile.avatar,
      };

      // All database operations handled by DAOs
      const [creatorUpdates, commenterUpdates, sharedUpdates] = await Promise.all([
        this.updateDAO.updateSimpleProfileDenormalization(userId, newProfile),
        this.commentDAO.updateCommenterProfileDenormalization(userId, newProfile),
        this.updateDAO.updateSharedFriendProfileDenormalization(userId, userProfile),
      ]);

      const totalUpdates = creatorUpdates + commenterUpdates + sharedUpdates;
      logger.info(`Updated ${totalUpdates} update-related profile references for user ${userId}`);
      return totalUpdates;
    } catch (error) {
      logger.error(`Error updating profile denormalization in updates for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Gets user notification preferences for an update
   * @param userId The user ID to check preferences for
   * @param score The update score
   * @returns User notification preferences
   */
  private async shouldSendNotification(userId: string, score: number): Promise<boolean> {
    // Get the user's profile to check notification settings
    const profile = await this.profileDAO.get(userId);
    if (!profile) {
      logger.warn(`Profile not found for user ${userId}`);
      return false;
    }

    const notificationSettings = profile.notification_settings || [];

    // If the user has no notification settings, skip
    if (!notificationSettings || notificationSettings.length === 0) {
      logger.info(`User ${userId} has no notification settings, skipping notification`);
      return false;
    }

    // Determine if we should send a notification based on user settings
    let shouldSendNotification = false;

    if (notificationSettings.includes(NotificationSettings.ALL)) {
      // User wants all notifications
      shouldSendNotification = true;
      logger.info(`User ${userId} has 'all' notification setting, will send notification`);
    } else if (notificationSettings.includes(NotificationSettings.URGENT) && (score === 5 || score === 1)) {
      // User only wants urgent notifications, check if this update is urgent
      shouldSendNotification = true;
      logger.info(`User ${userId} has 'urgent' notification setting, will send notification`);
    } else {
      logger.info(
        `User ${userId} has notification settings that don't include 'all' or 'urgent', skipping notification`,
      );
    }

    return shouldSendNotification;
  }

  /**
   * Generates a notification message for an update
   * @param updateData The update data
   * @param creatorName The creator's name
   * @param creatorGender The creator's gender
   * @param creatorLocation The creator's location
   * @param creatorBirthday The creator's birthday
   * @returns Generated notification message
   */
  private async generateUpdateNotificationMessage(
    updateData: UpdateDoc,
    creatorName: string,
    creatorGender: string,
    creatorLocation: string,
    creatorBirthday: string,
  ): Promise<string> {
    const updateContent = updateData.content || '';
    const sentiment = updateData.sentiment || '';
    const score = updateData.score || 3;

    // Calculate creator's age
    const creatorAge = calculateAge(creatorBirthday);

    try {
      const result = await generateNotificationMessageFlow({
        updateContent,
        sentiment,
        score: score.toString(),
        friendName: creatorName,
        friendGender: creatorGender,
        friendLocation: creatorLocation,
        friendAge: creatorAge,
      });

      return result.message;
    } catch (error) {
      logger.error(`Failed to generate notification message`, error);
      return `${creatorName} shared a new update`;
    }
  }

  /**
   * Deletes all updates created by a user and their associated feed entries
   * Uses DAO methods and batch processing for efficiency
   * @param userId The ID of the user whose updates should be deleted
   * @returns Object containing counts of deleted updates and feed entries
   */
  async deleteUserUpdatesAndFeeds(userId: string): Promise<{ updateCount: number; feedCount: number }> {
    logger.info(`Starting deletion of updates and feeds for user: ${userId}`);

    let updateCount = 0;
    let feedCount = 0;
    let batch = this.db.batch();
    let batchCount = 0;

    const updateIds: string[] = [];

    try {
      // First pass: Collect update IDs and delete user's own updates with their subcollections
      for await (const { doc: updateData, ref: updateRef } of this.updateDAO.streamUpdatesByCreator(userId)) {
        updateIds.push(updateData.id);

        // Use recursiveDelete for each update to handle subcollections (comments, reactions)
        await this.db.recursiveDelete(updateRef);
        updateCount++;

        logger.info(`Deleted update ${updateData.id} with all subcollections for user ${userId}`);
      }

      // Second pass: Delete all feed entries for the user (more efficient than per-update deletion)
      await this.feedDAO.delete(userId);
      logger.info(`Deleted user feed document for user ${userId}`);

      // Third pass: Remove user from visible_to arrays in updates where they were shared
      // This handles cases where the user was shared with but didn't create the update
      for await (const { doc: updateData } of this.updateDAO.streamUpdatesSharedWithUser(userId)) {
        this.updateDAO.removeFromVisibleTo(userId, updateData.id, batch);
        batchCount++;

        // Commit batch if it gets too large
        const result = await commitBatch(this.db, batch, batchCount);
        batch = result.batch;
        batchCount = result.batchCount;
      }

      // Fourth pass: Delete feed entries where the user appears as friend_id
      // Use efficient collection group query by friend_id from FeedDAO
      for await (const { ref } of this.feedDAO.streamFeedEntriesByFriendId(userId)) {
        batch.delete(ref);
        batchCount++;
        feedCount++;

        const result = await commitBatch(this.db, batch, batchCount);
        batch = result.batch;
        batchCount = result.batchCount;
      }

      // Commit remaining operations
      await commitFinal(batch, batchCount);

      logger.info(`Successfully deleted ${updateCount} updates and ${feedCount} feed entries for user ${userId}`);

      return { updateCount, feedCount };
    } catch (error) {
      logger.error(`Failed to delete updates and feeds for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * Checks if a user has access to view an update
   * @param updateData The update data to check
   * @param userId The user ID to check access for
   * @throws ForbiddenError if user doesn't have access
   */
  private async checkUpdateAccess(updateData: UpdateDoc, userId: string): Promise<void> {
    // Creator always has access
    if (updateData.created_by === userId) {
      return;
    }

    // Check if user is in visible_to array
    const friendIdentifier = createFriendVisibilityIdentifier(userId);
    if (updateData.visible_to.includes(friendIdentifier)) {
      return;
    }

    // Check friendship using FriendshipDAO
    const areFriends = await this.friendshipDAO.areFriends(updateData.created_by, userId);
    if (areFriends) {
      return;
    }

    throw new ForbiddenError("You don't have access to this update");
  }
}
