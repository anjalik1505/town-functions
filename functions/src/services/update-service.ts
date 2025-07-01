import { getFirestore, Timestamp, WriteBatch } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import path from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';
import { CommentDAO } from '../dao/comment-dao.js';
import { FeedDAO } from '../dao/feed-dao.js';
import { FriendshipDAO } from '../dao/friendship-dao.js';
import { GroupDAO } from '../dao/group-dao.js';
import { ProfileDAO } from '../dao/profile-dao.js';
import { ReactionDAO } from '../dao/reaction-dao.js';
import { UpdateDAO } from '../dao/update-dao.js';
import { ApiResponse, EventName, FeedViewEventParams, UpdateViewEventParams } from '../models/analytics-events.js';
import {
  Comment,
  CommentsResponse,
  CreateCommentPayload,
  CreateUpdatePayload,
  EnrichedUpdate,
  FeedResponse,
  PaginationPayload,
  ReactionGroup,
  Update,
  UpdateCommentPayload,
  UpdatesResponse,
  UpdateWithCommentsResponse,
} from '../models/data-models.js';
import {
  CommentDoc,
  CreatorProfile,
  FeedDoc,
  GroupProfile,
  UpdateDoc,
  UserProfile,
} from '../models/firestore/index.js';
import { shareUpdateSchema } from '../models/validation-schemas.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';

// Define the payload types from validation schemas
type ShareUpdatePayload = z.infer<typeof shareUpdateSchema>;

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

  constructor() {
    this.updateDAO = new UpdateDAO();
    this.commentDAO = new CommentDAO();
    this.reactionDAO = new ReactionDAO();
    this.feedDAO = new FeedDAO();
    this.profileDAO = new ProfileDAO();
    this.groupDAO = new GroupDAO();
    this.friendshipDAO = new FriendshipDAO();
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
    const creatorProfile = await this.profileDAO.findById(userId);
    if (!creatorProfile) {
      throw new NotFoundError('Creator profile not found');
    }

    // If allVillage is true, get all friends and groups of the user
    if (allVillage) {
      logger.info(`All village mode enabled, fetching all friends and groups for user: ${userId}`);

      // Get all friends using FriendshipDAO
      const tmpFriendIds = await this.friendshipDAO.getFriendIds(userId);

      // Get all groups where the user is a member
      const userGroups = await this.groupDAO.getGroupsByUser(userId);
      const tmpGroupIds = userGroups.map((group) => group.group_id);

      logger.info(`All village mode: found ${tmpFriendIds.length} friends and ${tmpGroupIds.length} groups`);

      // Deduplicate IDs
      friendIds = [...new Set([...friendIds, ...tmpFriendIds])];
      groupIds = [...new Set([...groupIds, ...tmpGroupIds])];
    }

    const creatorProfileData: CreatorProfile = {
      username: creatorProfile.username,
      name: creatorProfile.name,
      avatar: creatorProfile.avatar,
    };

    const updateId = await this.updateDAO.createId();

    // Process images - move from staging to final location
    const finalImagePaths = await this.copyImages(images, userId, updateId);

    // Fetch profiles for friends and groups for denormalization
    let sharedWithFriendsProfiles: UserProfile[] = [];
    let sharedWithGroupsProfiles: GroupProfile[] = [];

    if (friendIds.length > 0) {
      const friendProfiles = await this.profileDAO.fetchMultiple(friendIds);
      sharedWithFriendsProfiles = friendProfiles.map((profile) => ({
        user_id: profile.user_id,
        username: profile.username,
        name: profile.name,
        avatar: profile.avatar,
      }));
    }

    if (groupIds.length > 0) {
      const groups = await this.groupDAO.fetchMultiple(groupIds);
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
    const batch = getFirestore().batch();

    // Create the update within the batch
    const createResult = await this.updateDAO.create(
      updateId,
      updateData,
      creatorProfileData,
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

    const result = await this.updateDAO.getById(updateId, userId);
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

    const result = await this.updateDAO.getById(updateId);
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
      const friendProfiles = await this.profileDAO.fetchMultiple(additionalFriendIds);
      additionalFriendsProfiles = friendProfiles.map((profile) => ({
        user_id: profile.user_id,
        username: profile.username,
        name: profile.name,
        avatar: profile.avatar,
      }));
    }

    if (additionalGroupIds.length > 0) {
      const groups = await this.groupDAO.fetchMultiple(additionalGroupIds);
      additionalGroupsProfiles = groups.map((group) => ({
        group_id: group.id,
        name: group.name,
        icon: group.icon || '',
      }));
    }

    // Create a batch for atomic operations
    const batch = getFirestore().batch();

    // Update the update document within the batch
    const updatedData = await this.updateDAO.shareUpdate(
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

    const result = await this.updateDAO.getById(updateId);
    if (!result) {
      throw new NotFoundError('Update not found');
    }

    // Check access
    await this.updateDAO.hasUpdateAccessAsync(result.data, userId);

    // Get creator's profile for denormalization
    const creatorProfile = await this.profileDAO.findById(userId);
    if (!creatorProfile) {
      throw new NotFoundError('Creator profile not found');
    }

    const commentData = {
      created_by: userId,
      content: data.content,
      created_at: Timestamp.now(),
      updated_at: Timestamp.now(),
      parent_id: data.parent_id || null,
      commenter_profile: {
        username: creatorProfile.username,
        name: creatorProfile.name,
        avatar: creatorProfile.avatar,
      },
    };

    // Create batch for atomic operation
    const batch = getFirestore().batch();

    const { data: createdComment } = await this.commentDAO.create(result.ref, commentData, userId, batch);

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

    const result = await this.updateDAO.getById(updateId);
    if (!result) {
      throw new NotFoundError('Update not found');
    }

    const updatedComment = await this.commentDAO.updateComment(result.ref, commentId, data.content, userId);

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

    const result = await this.updateDAO.getById(updateId);
    if (!result) {
      throw new NotFoundError('Update not found');
    }

    // Create batch for atomic operation
    const batch = getFirestore().batch();

    await this.commentDAO.deleteComment(result.ref, commentId, userId, batch);

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

    const result = await this.updateDAO.getById(updateId);
    if (!result) {
      throw new NotFoundError('Update not found');
    }

    // Check access
    await this.updateDAO.hasUpdateAccessAsync(result.data, userId);

    // Create batch for atomic operation
    const batch = getFirestore().batch();

    await this.reactionDAO.upsertReaction(result.ref, userId, type, batch);

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

    const result = await this.updateDAO.getById(updateId);
    if (!result) {
      throw new NotFoundError('Update not found');
    }

    // Check access
    await this.updateDAO.hasUpdateAccessAsync(result.data, userId);

    // Create batch for atomic operation
    const batch = getFirestore().batch();

    // Remove only the specific reaction type
    await this.reactionDAO.deleteReaction(result.ref, userId, type, batch);

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

    const result = await this.updateDAO.getById(updateId);
    if (!result) {
      throw new NotFoundError('Update not found');
    }

    // Check access
    await this.updateDAO.hasUpdateAccessAsync(result.data, userId);

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
    const profile = await this.profileDAO.getById(userId);
    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    // Get the paginated feed results from DAO
    const { feedItems: feedDocs, nextCursor } = await this.feedDAO.getUserOwnFeed(userId, afterCursor, limit);

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
    const profile = await this.profileDAO.getById(userId);
    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    // Get the paginated feed results from DAO
    const { feedItems: feedDocs, nextCursor } = await this.feedDAO.getUserFullFeed(userId, afterCursor, limit);

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
    const targetProfile = await this.profileDAO.getById(targetUserId);
    if (!targetProfile) {
      throw new NotFoundError('Profile not found');
    }

    // Get the current user's profile
    const currentProfile = await this.profileDAO.getById(currentUserId);
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
    const { feedItems: feedDocs, nextCursor } = await this.feedDAO.getUserFriendFeed(
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
   * Processes staging images to final location
   * @param stagingPaths Array of staging image paths
   * @param userId The user ID for metadata
   * @param updateId The update ID for final path
   * @returns Array of final image paths
   */
  private async copyImages(stagingPaths: string[], userId: string, updateId: string): Promise<string[]> {
    if (stagingPaths.length === 0) {
      return [];
    }

    logger.info(`Processing ${stagingPaths.length} staging images`);

    const bucket = getStorage().bucket();
    const finalPaths: string[] = [];

    for (const stagingPath of stagingPaths) {
      try {
        const fileName = stagingPath.split('/').pop();
        if (!fileName) {
          logger.warn(`Invalid staging path: ${stagingPath}`);
          continue;
        }

        const srcFile = bucket.file(stagingPath);
        const destPath = `updates/${updateId}/${fileName}`;
        const destFile = bucket.file(destPath);

        // Copy with metadata
        await srcFile.copy(destFile);
        await destFile.setMetadata({
          metadata: {
            created_by: userId,
          },
        });

        // Delete staging file
        await srcFile.delete();
        finalPaths.push(destPath);

        logger.info(`Moved image from ${stagingPath} to ${destPath}`);
      } catch (error) {
        logger.error(`Failed to process image ${stagingPath}:`, error);
      }
    }

    return finalPaths;
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
      for (const groupId of groupIds) {
        const group = await this.groupDAO.findById(groupId);
        if (group) {
          const members = new Set(group.members);
          groupMembersMap.set(groupId, members);
          members.forEach((memberId) => usersToNotify.add(memberId));
        }
      }
    }

    // Create feed items (batch will be passed through to FeedDAO)
    await this.feedDAO.createFeedItemsForUpdate(
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
    const creatorProfile = updateData.creator_profile || { username: '', name: '', avatar: '' };

    return {
      ...update,
      username: creatorProfile.username,
      name: creatorProfile.name,
      avatar: creatorProfile.avatar,
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
}
