import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { ChatDAO } from '../dao/chat-dao.js';
import { FriendshipDAO } from '../dao/friendship-dao.js';
import { GroupDAO } from '../dao/group-dao.js';
import { ProfileDAO } from '../dao/profile-dao.js';
import { ApiResponse, EventName } from '../models/analytics-events.js';
import { Collections } from '../models/constants.js';
import {
  ChatMessage,
  ChatResponse,
  Group,
  GroupMember,
  GroupsResponse,
  Update,
  UpdatesResponse,
} from '../models/data-models.js';
import { ChatDoc } from '../models/firestore/chat-doc.js';
import { GroupDoc } from '../models/firestore/group-doc.js';
import { CreatorProfile } from '../models/firestore/update-doc.js';
import { commitBatch, commitFinal } from '../utils/batch-utils.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Service layer for Group-related operations
 * Coordinates between GroupDAO, ChatDAO, ProfileDAO, and FriendshipDAO
 */
export class GroupService {
  private groupDAO: GroupDAO;
  private chatDAO: ChatDAO;
  private profileDAO: ProfileDAO;
  private friendshipDAO: FriendshipDAO;
  private db: FirebaseFirestore.Firestore;

  constructor() {
    this.groupDAO = new GroupDAO();
    this.chatDAO = new ChatDAO();
    this.profileDAO = new ProfileDAO();
    this.friendshipDAO = new FriendshipDAO();
    this.db = getFirestore();
  }

  /**
   * Creates a new group with all-friends validation
   * Ensures all members are friends with each other (O(n²) check)
   */
  async createGroup(
    userId: string,
    data: {
      name: string;
      icon?: string;
      members?: string[];
    },
  ): Promise<ApiResponse<Group>> {
    logger.info(`Creating group for user ${userId}`, { data });

    // Ensure current user is in members list
    const allMembers = data.members || [];
    if (!allMembers.includes(userId)) {
      allMembers.push(userId);
    }

    // Validate all members exist
    const memberProfiles = await this.profileDAO.getAll(allMembers);
    const existingUserIds = new Set(memberProfiles.filter((p) => p && p.user_id).map((p) => p!.user_id));

    const missingMembers = allMembers.filter((id) => !existingUserIds.has(id));
    if (missingMembers.length > 0) {
      throw new NotFoundError(`Member profiles not found: ${missingMembers.join(', ')}`);
    }

    // Validate all members are friends with each other (O(n²) friendship check)
    for (let i = 0; i < allMembers.length; i++) {
      for (let j = i + 1; j < allMembers.length; j++) {
        const memberId1 = allMembers[i]!;
        const memberId2 = allMembers[j]!;
        const areFriends = await this.friendshipDAO.areFriends(memberId1, memberId2);
        if (!areFriends) {
          throw new BadRequestError('All members must be friends with each other to be in the same group');
        }
      }
    }

    // Create member profiles map for denormalization
    const memberProfilesMap: Record<string, any> = {};
    for (const profile of memberProfiles) {
      memberProfilesMap[profile.user_id] = {
        name: profile.name,
        username: profile.username,
        avatar: profile.avatar,
      };
    }

    // Create group
    const groupData: Partial<GroupDoc> = {
      name: data.name,
      icon: data.icon || '',
      members: allMembers,
      member_profiles: memberProfilesMap,
      created_at: Timestamp.now(),
    };

    const { id: groupId } = await this.groupDAO.create(groupData);

    // Update member profiles with the new group ID
    const batch = this.db.batch();
    for (const memberId of allMembers) {
      const profileRef = this.db.collection(Collections.PROFILES).doc(memberId);
      batch.update(profileRef, {
        group_ids: FieldValue.arrayUnion(groupId),
        updated_at: Timestamp.now(),
      });
    }
    await batch.commit();

    logger.info(`Successfully created group ${groupId}`);

    // Convert member_profiles from Record to array format for the response
    const memberProfilesArray = Object.entries(memberProfilesMap).map(([userId, profile]) => ({
      user_id: userId,
      username: profile.username,
      name: profile.name,
      avatar: profile.avatar,
    }));

    // Return formatted group
    const group: Group = {
      group_id: groupId,
      name: groupData.name!,
      icon: groupData.icon!,
      members: allMembers,
      member_profiles: memberProfilesArray,
      created_at: formatTimestamp(groupData.created_at!),
    };

    return {
      data: group,
      status: 201,
      analytics: {
        event: EventName.GROUP_CREATED,
        userId: userId,
        params: {
          member_count: allMembers.length,
        },
      },
    };
  }

  /**
   * Adds members to an existing group
   * Validates that new members are friends with ALL existing members
   */
  async addMembers(userId: string, groupId: string, newMemberIds: string[]): Promise<ApiResponse<null>> {
    logger.info(`Adding members to group ${groupId}`, { userId, newMemberIds });

    // Get group and validate membership
    const group = await this.groupDAO.get(groupId);
    if (!group) {
      throw new NotFoundError('Group not found');
    }

    if (!group.members.includes(userId)) {
      throw new ForbiddenError('You must be a member of the group to add members');
    }

    // Deduplicate and filter out existing members
    const uniqueNewMembers = [...new Set(newMemberIds)].filter((id) => !group.members.includes(id));

    if (uniqueNewMembers.length === 0) {
      throw new BadRequestError('All specified users are already members of the group');
    }

    // Validate new members exist
    const newMemberProfiles = await this.profileDAO.getAll(uniqueNewMembers);
    const existingUserIds = new Set(newMemberProfiles.map((p) => p.user_id));

    const missingMembers = uniqueNewMembers.filter((id) => !existingUserIds.has(id));
    if (missingMembers.length > 0) {
      throw new NotFoundError(`Member profiles not found: ${missingMembers.join(', ')}`);
    }

    // Validate new members are friends with ALL existing members
    for (const newMemberId of uniqueNewMembers) {
      for (const existingMemberId of group.members) {
        const areFriends = await this.friendshipDAO.areFriends(newMemberId, existingMemberId);
        if (!areFriends) {
          throw new BadRequestError('All members must be friends with each other to be in the same group');
        }
      }
    }

    // Prepare new member profiles for denormalization
    const newMemberProfilesMap: Record<string, any> = {};
    for (const profile of newMemberProfiles) {
      newMemberProfilesMap[profile.user_id] = {
        name: profile.name,
        username: profile.username,
        avatar: profile.avatar,
      };
    }

    // Update group with new members
    await this.groupDAO.addMembers(groupId, uniqueNewMembers, newMemberProfilesMap);

    // Update new member profiles with the group ID
    const batch = this.db.batch();
    for (const memberId of uniqueNewMembers) {
      const profileRef = this.db.collection(Collections.PROFILES).doc(memberId);
      batch.update(profileRef, {
        group_ids: FieldValue.arrayUnion(groupId),
        updated_at: Timestamp.now(),
      });
    }
    await batch.commit();

    logger.info(`Successfully added ${uniqueNewMembers.length} members to group ${groupId}`);

    return {
      data: null,
      status: 200,
      analytics: {
        event: EventName.GROUP_MEMBERS_ADDED,
        userId: userId,
        params: {
          group_id: groupId,
          new_member_count: uniqueNewMembers.length,
          total_member_count: group.members.length + uniqueNewMembers.length,
        },
      },
    };
  }

  /**
   * Gets group members with denormalized data
   */
  async getGroupMembers(userId: string, groupId: string): Promise<ApiResponse<GroupMember[]>> {
    logger.info(`Getting members for group ${groupId}`, { userId });

    const group = await this.groupDAO.get(groupId);
    if (!group) {
      throw new NotFoundError('Group not found');
    }

    if (!group.members.includes(userId)) {
      throw new ForbiddenError('You must be a member of the group to view members');
    }

    // Format member data from denormalized profiles
    const members: GroupMember[] = group.members.map((memberId) => {
      const profile = group.member_profiles[memberId];
      return {
        user_id: memberId,
        username: profile?.username || '',
        name: profile?.name || '',
        avatar: profile?.avatar || '',
      };
    });

    logger.info(`Retrieved ${members.length} members for group ${groupId}`);

    return {
      data: members,
      status: 200,
      analytics: {
        event: EventName.GROUP_MEMBERS_VIEWED,
        userId: userId,
        params: {
          group_id: groupId,
          member_count: members.length,
        },
      },
    };
  }

  /**
   * Gets updates visible to a group
   */
  async getGroupFeed(
    userId: string,
    groupId: string,
    pagination?: { limit?: number; after_cursor?: string },
  ): Promise<ApiResponse<UpdatesResponse>> {
    logger.info(`Getting feed for group ${groupId}`, { userId, pagination });

    const group = await this.groupDAO.get(groupId);
    if (!group) {
      throw new NotFoundError('Group not found');
    }

    if (!group.members.includes(userId)) {
      throw new ForbiddenError('You must be a member of the group to view the feed');
    }

    // Query updates visible to this group
    const limit = pagination?.limit || 20;
    const visibilityFilter = `group:${groupId}`;

    let query = this.db
      .collection(Collections.UPDATES)
      .where('visible_to', 'array-contains', visibilityFilter)
      .orderBy('created_at', 'desc')
      .limit(limit + 1);

    if (pagination?.after_cursor) {
      const cursorDoc = await this.db.collection(Collections.UPDATES).doc(pagination.after_cursor).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snapshot = await query.get();
    const updates: Update[] = [];
    let nextCursor: string | null = null;

    snapshot.docs.slice(0, limit).forEach((doc) => {
      const data = doc.data();
      updates.push({
        update_id: doc.id,
        created_by: data.user_id || data.created_by,
        content: data.text || data.content,
        group_ids: data.group_ids || [],
        friend_ids: data.friend_ids || [],
        sentiment: data.sentiment || '',
        score: data.score || 0,
        emoji: data.emoji || '',
        created_at: formatTimestamp(data.created_at),
        comment_count: data.comment_count || 0,
        reaction_count: data.reaction_count || 0,
        reactions: data.reactions || [],
        all_village: data.all_village || false,
        images: data.image_urls || data.images || [],
        shared_with_friends: data.shared_with_friends || [],
        shared_with_groups: data.shared_with_groups || [],
      });
    });

    if (snapshot.docs.length > limit) {
      nextCursor = snapshot.docs[limit - 1]!.id;
    }

    logger.info(`Retrieved ${updates.length} updates for group ${groupId}`);

    return {
      data: { updates, next_cursor: nextCursor },
      status: 200,
      analytics: {
        event: EventName.GROUP_FEED_VIEWED,
        userId: userId,
        params: {
          group_id: groupId,
          update_count: updates.length,
        },
      },
    };
  }

  /**
   * Creates a chat message in a group
   */
  async createChatMessage(
    userId: string,
    groupId: string,
    data: {
      text: string;
      attachments?: string[];
    },
  ): Promise<ApiResponse<ChatMessage>> {
    logger.info(`Creating chat message in group ${groupId}`, { userId });

    const group = await this.groupDAO.get(groupId);
    if (!group) {
      throw new NotFoundError('Group not found');
    }

    if (!group.members.includes(userId)) {
      throw new ForbiddenError('You must be a member of the group to send messages');
    }

    const chatData: ChatDoc = {
      sender_id: userId,
      text: data.text,
      created_at: Timestamp.now(),
      attachments: (data.attachments || []).map((url) => ({ type: 'image', url, thumbnail: url })),
    };

    const chatId = await this.chatDAO.create(groupId, chatData);

    logger.info(`Successfully created chat message ${chatId} in group ${groupId}`);

    // Convert to ChatMessage format (using message_id and string[] attachments)
    const chatMessage: ChatMessage = {
      message_id: chatId.id,
      sender_id: chatData.sender_id,
      text: chatData.text,
      created_at: formatTimestamp(chatData.created_at),
      ...(data.attachments && { attachments: data.attachments }),
    };

    return {
      data: chatMessage,
      status: 201,
      analytics: {
        event: EventName.GROUP_MESSAGE_SENT,
        userId: userId,
        params: {
          group_id: groupId,
          text_length: data.text.length,
          attachment_count: (data.attachments || []).length,
        },
      },
    };
  }

  /**
   * Gets chat messages from a group
   */
  async getGroupChats(
    userId: string,
    groupId: string,
    pagination?: { limit?: number; after_cursor?: string },
  ): Promise<ApiResponse<ChatResponse>> {
    logger.info(`Getting chats for group ${groupId}`, { userId, pagination });

    const group = await this.groupDAO.get(groupId);
    if (!group) {
      throw new NotFoundError('Group not found');
    }

    if (!group.members.includes(userId)) {
      throw new ForbiddenError('You must be a member of the group to view messages');
    }

    const result = await this.chatDAO.get(groupId, {
      limit: pagination?.limit,
      afterCursor: pagination?.after_cursor,
    });

    logger.info(`Retrieved ${result.messages.length} chats for group ${groupId}`);

    return {
      data: {
        messages: result.messages,
        next_cursor: result.next_cursor,
      },
      status: 200,
      analytics: {
        event: EventName.GROUP_CHATS_VIEWED,
        userId: userId,
        params: {
          group_id: groupId,
          chat_count: result.messages.length,
        },
      },
    };
  }

  /**
   * Gets groups where a user is a member
   */
  async getUserGroups(
    userId: string,
    pagination?: { limit?: number; after_cursor?: string },
  ): Promise<ApiResponse<GroupsResponse>> {
    logger.info(`Getting groups for user ${userId}`, { pagination });

    // For now, we don't support cursor-based pagination for user groups
    // This would require a different query structure
    const baseGroups = await this.groupDAO.getForUser(userId);

    // Fetch full group data for each group
    const groupIds = baseGroups.map((g) => g.group_id);
    const fullGroups = await this.groupDAO.getGroups(groupIds);

    // Convert to Group format with denormalized member profiles
    const groups: Group[] = fullGroups.map((groupDoc) => {
      // Convert member_profiles from Record to array format
      const memberProfilesArray = Object.entries(groupDoc.member_profiles || {}).map(([userId, profile]) => ({
        user_id: userId,
        username: profile.username || '',
        name: profile.name || '',
        avatar: profile.avatar || '',
      }));

      return {
        group_id: groupDoc.id,
        name: groupDoc.name,
        icon: groupDoc.icon || '',
        members: groupDoc.members || [],
        member_profiles: memberProfilesArray,
        created_at: formatTimestamp(groupDoc.created_at),
      };
    });

    logger.info(`Retrieved ${groups.length} groups for user ${userId}`);

    return {
      data: {
        groups,
      },
      status: 200,
      analytics: {
        event: EventName.USER_GROUPS_VIEWED,
        userId: userId,
        params: {
          group_count: groups.length,
        },
      },
    };
  }

  /**
   * Updates member profile denormalization across all groups where the user is a member
   */
  async updateMemberProfileDenormalization(userId: string, newProfile: CreatorProfile): Promise<number> {
    logger.info(`Updating member profile denormalization in groups for user ${userId}`);

    let totalUpdates = 0;

    try {
      // Get all groups where the user is a member
      const userGroups = await this.groupDAO.getForUser(userId);

      if (userGroups.length === 0) {
        logger.info(`User ${userId} is not a member of any groups`);
        return 0;
      }

      // Update each group individually since updateMemberProfiles doesn't support batching
      for (const group of userGroups) {
        await this.groupDAO.updateMemberProfiles(group.group_id, { [userId]: newProfile });
        totalUpdates++;
      }
      logger.info(`Updated ${totalUpdates} group member profiles for user ${userId}`);
      return totalUpdates;
    } catch (error) {
      logger.error(`Error updating member profile denormalization in groups for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Removes a user from all groups they are a member of
   * Updates both the members array and member_profiles object
   */
  async removeUserFromAllGroups(userId: string): Promise<number> {
    logger.info(`Removing user ${userId} from all groups`);

    let totalUpdates = 0;

    try {
      // Get all groups where the user is a member
      const userGroups = await this.groupDAO.getForUser(userId);

      if (userGroups.length === 0) {
        logger.info(`User ${userId} is not a member of any groups`);
        return 0;
      }

      let batch = this.db.batch();
      let batchCount = 0;

      for (const group of userGroups) {
        await this.groupDAO.removeMember(group.group_id, userId, batch);

        const result = await commitBatch(this.db, batch, batchCount);
        batch = result.batch;
        batchCount = result.batchCount;

        totalUpdates++;
      }

      await commitFinal(batch, batchCount);

      logger.info(`Removed user ${userId} from ${totalUpdates} groups`);
      return totalUpdates;
    } catch (error) {
      logger.error(`Error removing user ${userId} from groups:`, error);
      throw error;
    }
  }
}
