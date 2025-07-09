import { getFirestore, Timestamp, WriteBatch } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { CommentDAO } from '../dao/comment-dao.js';
import { FeedDAO } from '../dao/feed-dao.js';
import { FriendshipDAO } from '../dao/friendship-dao.js';
import { GroupDAO } from '../dao/group-dao.js';
import { ProfileDAO } from '../dao/profile-dao.js';
import { ReactionDAO } from '../dao/reaction-dao.js';
import { StorageDAO } from '../dao/storage-dao.js';
import { UpdateDAO } from '../dao/update-dao.js';
import { ApiResponse, EventName } from '../models/analytics-events.js';
import {
  CreateCommentPayload,
  CreateUpdatePayload,
  PaginationPayload,
  ShareUpdatePayload,
  UpdateCommentPayload,
} from '../models/api-payloads.js';
import {
  Comment,
  CommentsResponse,
  ReactionGroup,
  Update,
  UpdateWithCommentsResponse,
} from '../models/api-responses.js';
import { CommentDoc, GroupProfile, SimpleProfile, UpdateDoc, UserProfile } from '../models/firestore/index.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';
import { createFriendVisibilityIdentifier } from '../utils/visibility-utils.js';
import { FeedQueryService } from './index.js';

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
      share_count: 0,
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

    // Increment update count for the creator
    this.profileDAO.incrementUpdateCount(userId, batch);

    // Commit the batch
    await batch.commit();

    // Return the created update
    return {
      data: FeedQueryService.formatUpdate(createResult.data),
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
    const enrichedUpdate = FeedQueryService.formatEnrichedUpdate(updateData);

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
        data: FeedQueryService.formatUpdate(updateData),
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
      true, // incrementShareCount for trigger detection
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
      data: FeedQueryService.formatUpdate(updatedData),
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
