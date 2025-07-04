import { DocumentReference, FieldValue, WriteBatch } from 'firebase-admin/firestore';
import { Collections, QueryOperators } from '../models/constants.js';
import {
  CreatorProfile,
  GroupProfile,
  uf,
  updateConverter,
  UpdateDoc,
  UserProfile,
} from '../models/firestore/index.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';
import {
  createFriendVisibilityIdentifier,
  createFriendVisibilityIdentifiers,
  createGroupVisibilityIdentifiers,
} from '../utils/visibility-utils.js';
import { BaseDAO } from './base-dao.js';

/**
 * Data Access Object for Update documents with heavy denormalization handling
 * Manages creator_profile, shared_with_*_profiles, and visibility patterns
 */
export class UpdateDAO extends BaseDAO<UpdateDoc> {
  constructor() {
    super(Collections.UPDATES, updateConverter);
  }

  /**
   * Creates a new update with full denormalization handling
   * @returns The ID of the created update
   */
  async createId(): Promise<string> {
    return this.db.collection(this.collection).withConverter(this.converter).doc().id;
  }

  /**
   * Creates a new update with full denormalization handling
   * @param updateId The ID of the update to create
   * @param updateData The update data to create
   * @param creatorProfile The creator's profile for denormalization
   * @param friendIds Array of friend IDs to share with
   * @param groupIds Array of group IDs to share with
   * @param sharedWithFriendsProfiles Array of friend profiles for denormalization
   * @param sharedWithGroupsProfiles Array of group profiles for denormalization
   * @param batch Optional WriteBatch to add operations to (won't commit if provided)
   * @returns The ID and data of the created update
   */
  async create(
    updateId: string,
    updateData: Omit<
      UpdateDoc,
      'id' | 'creator_profile' | 'shared_with_friends_profiles' | 'shared_with_groups_profiles'
    >,
    creatorProfile: CreatorProfile,
    friendIds: string[] = [],
    groupIds: string[] = [],
    sharedWithFriendsProfiles: UserProfile[] = [],
    sharedWithGroupsProfiles: GroupProfile[] = [],
    batch?: WriteBatch,
  ): Promise<{ id: string; data: UpdateDoc }> {
    // Prepare the visible_to array for efficient querying
    const visibleTo: string[] = [];
    visibleTo.push(createFriendVisibilityIdentifier(updateData.created_by));
    visibleTo.push(...createFriendVisibilityIdentifiers(friendIds));
    visibleTo.push(...createGroupVisibilityIdentifiers(groupIds));

    const updateRef = this.db.collection(this.collection).withConverter(this.converter).doc(updateId);

    const fullUpdateData: UpdateDoc = {
      ...updateData,
      id: updateId,
      visible_to: visibleTo,
      creator_profile: creatorProfile,
      shared_with_friends_profiles: sharedWithFriendsProfiles,
      shared_with_groups_profiles: sharedWithGroupsProfiles,
    };

    if (batch) {
      batch.set(updateRef, fullUpdateData);
    } else {
      await updateRef.set(fullUpdateData);
    }
    return { id: updateId, data: fullUpdateData };
  }

  /**
   * Gets an update by ID with access checking
   * @param updateId The ID of the update
   * @param requestingUserId Optional user ID to check access
   * @returns The update document and reference
   */
  async getById(
    updateId: string,
    requestingUserId?: string,
  ): Promise<{ data: UpdateDoc; ref: DocumentReference } | null> {
    const updateRef = this.db.collection(this.collection).withConverter(this.converter).doc(updateId);
    const updateDoc = await updateRef.get();

    if (!updateDoc.exists) {
      return null;
    }

    const updateData = updateDoc.data();
    if (!updateData) {
      throw new Error('Update document data is undefined');
    }

    // Check access if requesting user is provided
    if (requestingUserId) {
      this.hasUpdateAccess(updateData, requestingUserId);
    }

    return {
      data: updateData,
      ref: updateRef,
    };
  }

  /**
   * Checks if a user has access to view an update
   * @param updateData The update data to check
   * @param userId The user ID to check access for
   * @throws ForbiddenError if user doesn't have access
   */
  hasUpdateAccess(updateData: UpdateDoc, userId: string): void {
    // Creator always has access
    if (updateData.created_by === userId) {
      return;
    }

    const friendIdentifier = createFriendVisibilityIdentifier(userId);

    // Check if user is in visible_to array
    if (updateData.visible_to.includes(friendIdentifier)) {
      return;
    }

    throw new ForbiddenError("You don't have access to this update");
  }

  /**
   * Shares an update with additional friends or groups
   * @param updateId The ID of the update to share
   * @param additionalFriendIds Additional friend IDs to share with
   * @param additionalGroupIds Additional group IDs to share with
   * @param additionalFriendsProfiles Profiles for the additional friends
   * @param additionalGroupsProfiles Profiles for the additional groups
   * @param batch Optional WriteBatch to add operations to (won't commit if provided)
   * @returns Updated UpdateDoc
   */
  async shareUpdate(
    updateId: string,
    additionalFriendIds: string[] = [],
    additionalGroupIds: string[] = [],
    additionalFriendsProfiles: UserProfile[] = [],
    additionalGroupsProfiles: GroupProfile[] = [],
    batch?: WriteBatch,
  ): Promise<UpdateDoc> {
    const result = await this.getById(updateId);
    if (!result) {
      throw new NotFoundError('Update not found');
    }

    const { data: updateData, ref: updateRef } = result;

    // Update arrays with new values
    const newFriendIds = [...new Set([...updateData.friend_ids, ...additionalFriendIds])];
    const newGroupIds = [...new Set([...updateData.group_ids, ...additionalGroupIds])];

    // Update denormalized profiles
    const newSharedWithFriendsProfiles = [...updateData.shared_with_friends_profiles, ...additionalFriendsProfiles];
    const newSharedWithGroupsProfiles = [...updateData.shared_with_groups_profiles, ...additionalGroupsProfiles];

    // Update visible_to array
    const newVisibleTo = [
      ...updateData.visible_to,
      ...createFriendVisibilityIdentifiers(additionalFriendIds),
      ...createGroupVisibilityIdentifiers(additionalGroupIds),
    ];

    const updateFields = {
      friend_ids: newFriendIds,
      group_ids: newGroupIds,
      visible_to: [...new Set(newVisibleTo)], // Remove duplicates
      shared_with_friends_profiles: newSharedWithFriendsProfiles,
      shared_with_groups_profiles: newSharedWithGroupsProfiles,
    };

    if (batch) {
      batch.update(updateRef, updateFields);
    } else {
      await updateRef.update(updateFields);
    }

    // Return updated data
    return {
      ...updateData,
      ...updateFields,
    };
  }

  /**
   * Batch fetches multiple updates by their IDs
   * @param updateIds Array of update IDs to fetch
   * @returns Map of update ID to UpdateDoc for easy lookup
   */
  async getAll(updateIds: string[]): Promise<Map<string, UpdateDoc>> {
    if (updateIds.length === 0) {
      return new Map();
    }

    // Create document references for all update IDs
    const docRefs = updateIds.map((id) => this.db.collection(this.collection).withConverter(this.converter).doc(id));

    // Fetch all documents in a single round trip
    const docs = await this.db.getAll(...docRefs);

    // Build result map, only including documents that exist
    const resultMap = new Map<string, UpdateDoc>();

    docs.forEach((doc, index) => {
      if (doc.exists && index < updateIds.length) {
        const data = doc.data();
        const updateId = updateIds[index];
        if (data && updateId) {
          resultMap.set(updateId, data as UpdateDoc);
        }
      }
    });

    return resultMap;
  }

  /**
   * Increments the comment count for an update by 1
   * @param updateId The update ID to update
   * @param batch The batch to add the update operation to
   */
  incrementCommentCount(updateId: string, batch: WriteBatch): void {
    const docRef = this.db.collection(this.collection).doc(updateId);
    batch.update(docRef, {
      comment_count: FieldValue.increment(1),
    });
  }

  /**
   * Decrements the comment count for an update by 1
   * @param updateId The update ID to update
   * @param batch The batch to add the update operation to
   */
  decrementCommentCount(updateId: string, batch: WriteBatch): void {
    const docRef = this.db.collection(this.collection).doc(updateId);
    batch.update(docRef, {
      comment_count: FieldValue.increment(-1),
    });
  }

  /**
   * Increments the reaction count and specific reaction type count for an update
   * @param updateId The update ID to update
   * @param reactionType The reaction type to increment
   * @param batch The batch to add the update operation to
   */
  incrementReactionCount(updateId: string, reactionType: string, batch: WriteBatch): void {
    const docRef = this.db.collection(this.collection).doc(updateId);
    batch.update(docRef, {
      reaction_count: FieldValue.increment(1),
      [`reaction_types.${reactionType}`]: FieldValue.increment(1),
    });
  }

  /**
   * Decrements the reaction count and specific reaction type count for an update
   * @param updateId The update ID to update
   * @param reactionType The reaction type to decrement
   * @param batch The batch to add the update operation to
   */
  decrementReactionCount(updateId: string, reactionType: string, batch: WriteBatch): void {
    const docRef = this.db.collection(this.collection).doc(updateId);
    batch.update(docRef, {
      reaction_count: FieldValue.increment(-1),
      [`reaction_types.${reactionType}`]: FieldValue.increment(-1),
    });
  }

  /**
   * Gets all_village updates for a user with streaming support
   * @param userId The creator user ID
   * @returns AsyncIterable of UpdateDoc
   */
  async *streamAllVillageUpdatesByUser(userId: string): AsyncIterable<UpdateDoc> {
    const query = this.db
      .collection(this.collection)
      .withConverter(this.converter)
      .where(uf('created_by'), QueryOperators.EQUALS, userId)
      .where(uf('all_village'), QueryOperators.EQUALS, true)
      .orderBy(uf('created_at'), QueryOperators.DESC);

    const stream = query.stream() as AsyncIterable<FirebaseFirestore.QueryDocumentSnapshot<UpdateDoc>>;
    for await (const doc of stream) {
      const data = doc.data();
      if (data) {
        yield data;
      }
    }
  }
}
