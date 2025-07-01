import { FieldValue } from 'firebase-admin/firestore';
import { Collections, QueryOperators } from '../models/constants.js';
import { BaseGroup } from '../models/data-models.js';
import { GroupDoc, gf, groupConverter } from '../models/firestore/index.js';
import { BaseDAO } from './base-dao.js';

/**
 * Data Access Object for Group documents
 * Manages groups with member denormalization
 */
export class GroupDAO extends BaseDAO<GroupDoc> {
  constructor() {
    super(Collections.GROUPS, groupConverter);
  }

  /**
   * Gets groups where a user is a member
   * @param userId The user ID to find groups for
   * @returns Array of BaseGroup objects
   */
  async getGroupsByUser(userId: string): Promise<BaseGroup[]> {
    const query = this.db
      .collection(this.collection)
      .withConverter(this.converter)
      .where(gf('members'), QueryOperators.ARRAY_CONTAINS, userId);

    const snapshot = await query.get();

    return snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        group_id: doc.id,
        name: data.name || '',
        icon: data.icon || '',
      };
    });
  }

  /**
   * Creates a new group
   * @param groupData The group data with denormalized member profiles
   * @returns The created group with its ID
   */
  async create(groupData: Partial<GroupDoc>): Promise<{ id: string; data: GroupDoc }> {
    const groupRef = this.db.collection(this.collection).withConverter(this.converter).doc();
    const groupId = groupRef.id;
    const fullGroupData = { ...groupData, id: groupId } as GroupDoc;
    await groupRef.set(fullGroupData);
    return { id: groupId, data: fullGroupData };
  }

  /**
   * Fetches multiple groups by their IDs
   * @param groupIds Array of group IDs to fetch
   * @returns Array of GroupDoc objects with id property
   */
  async fetchMultiple(groupIds: string[]): Promise<Array<GroupDoc & { id: string }>> {
    if (groupIds.length === 0) return [];

    const docRefs = groupIds.map((id) => this.db.collection(this.collection).withConverter(this.converter).doc(id));
    const docs = await this.db.getAll(...docRefs);

    return docs
      .filter((doc) => doc.exists)
      .map((doc) => ({
        ...(doc.data()! as GroupDoc),
        id: doc.id,
      }));
  }

  /**
   * Adds members to an existing group
   * @param groupId The group ID to add members to
   * @param newMembers Array of new member user IDs
   * @param newProfiles Map of new member profiles
   * @returns The updated group document
   */
  async addMembers(groupId: string, newMembers: string[], newProfiles: Record<string, any>): Promise<GroupDoc> {
    const groupRef = this.db.collection(this.collection).withConverter(this.converter).doc(groupId);

    // Update members array
    await groupRef.update({
      members: FieldValue.arrayUnion(...newMembers),
    });

    // Update member_profiles separately
    const profileUpdates: Record<string, any> = {};
    Object.entries(newProfiles).forEach(([userId, profile]) => {
      profileUpdates[`member_profiles.${userId}`] = profile;
    });

    if (Object.keys(profileUpdates).length > 0) {
      await groupRef.update(profileUpdates);
    }

    // Fetch and return the updated document
    const updatedDoc = await groupRef.get();
    if (!updatedDoc.exists) {
      throw new Error('Group not found after update');
    }
    return updatedDoc.data()!;
  }

  /**
   * Updates member profiles in a group
   * @param groupId The group ID to update
   * @param profileUpdates Map of user IDs to updated profile data
   */
  async updateMemberProfiles(groupId: string, profileUpdates: Record<string, any>): Promise<void> {
    const updates: Record<string, any> = {};

    // Build field paths for nested updates
    Object.entries(profileUpdates).forEach(([userId, profileData]) => {
      updates[`member_profiles.${userId}`] = profileData;
    });

    await this.db.collection(this.collection).doc(groupId).withConverter(this.converter).update(updates);
  }

  /**
   * Checks if a user is a member of a group
   * @param groupId The group ID to check
   * @param userId The user ID to check
   * @returns True if the user is a member
   */
  async isMember(groupId: string, userId: string): Promise<boolean> {
    const group = await this.findById(groupId);
    return group ? group.members.includes(userId) : false;
  }
}
