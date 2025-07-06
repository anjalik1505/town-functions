import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { FriendshipDAO } from '../dao/friendship-dao.js';
import { GroupDAO } from '../dao/group-dao.js';
import { ProfileDAO } from '../dao/profile-dao.js';
import { ApiResponse, EventName } from '../models/analytics-events.js';
import { Collections } from '../models/constants.js';
import { Group, GroupMember, GroupsResponse } from '../models/data-models.js';
import { GroupDoc, SimpleProfile } from '../models/firestore/index.js';
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
  private profileDAO: ProfileDAO;
  private friendshipDAO: FriendshipDAO;
  private db: FirebaseFirestore.Firestore;

  constructor() {
    this.groupDAO = new GroupDAO();
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
    const memberProfilesMap: Record<string, SimpleProfile> = {};
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
    const newMemberProfilesMap: Record<string, SimpleProfile> = {};
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
  async updateMemberProfileDenormalization(userId: string, newProfile: SimpleProfile): Promise<number> {
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
}
