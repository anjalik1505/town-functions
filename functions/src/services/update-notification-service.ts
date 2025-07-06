import path from 'path';
import { fileURLToPath } from 'url';
import { generateNotificationMessageFlow } from '../ai/flows.js';
import { CommentDAO } from '../dao/comment-dao.js';
import { GroupDAO } from '../dao/group-dao.js';
import { ProfileDAO } from '../dao/profile-dao.js';
import { UpdateDAO } from '../dao/update-dao.js';
import { NotificationTypes } from '../models/constants.js';
import { CommentDoc, UpdateDoc, ReactionDoc, NotificationSettings } from '../models/firestore/index.js';
import { getLogger } from '../utils/logging-utils.js';
import { calculateAge } from '../utils/profile-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Service layer for update notification preparation
 * Handles background notification logic preparation separately from content operations
 */
export class UpdateNotificationService {
  private updateDAO: UpdateDAO;
  private commentDAO: CommentDAO;
  private profileDAO: ProfileDAO;
  private groupDAO: GroupDAO;

  constructor() {
    this.updateDAO = new UpdateDAO();
    this.commentDAO = new CommentDAO();
    this.profileDAO = new ProfileDAO();
    this.groupDAO = new GroupDAO();
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
    logger.info(`Preparing update notifications for update ${updateData.id}`);

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
    const creatorProfile = await this.profileDAO.get(creatorId);
    let creatorName = 'Friend';
    let creatorGender = 'They';
    let creatorLocation = '';
    let creatorBirthday = '';

    if (creatorProfile) {
      creatorName = creatorProfile.name || creatorProfile.username || 'Friend';
      creatorGender = creatorProfile.gender || 'They';
      creatorLocation = creatorProfile.location || '';
      creatorBirthday = creatorProfile.birthday || '';
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
   * Gets user notification preferences for an update
   * @param userId The user ID to check preferences for
   * @param score The update score
   * @returns Whether the user should receive a notification
   */
  async shouldSendNotification(userId: string, score: number): Promise<boolean> {
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
  async generateUpdateNotificationMessage(
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
}
