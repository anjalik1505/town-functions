import { DocumentReference, FieldValue, Timestamp, WriteBatch } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { Collections, QueryOperators, MAX_BATCH_OPERATIONS } from '../models/constants.js';
import {
  CreatorProfile,
  GroupProfile,
  uf,
  updateConverter,
  UpdateDoc,
  UserProfile,
} from '../models/firestore/index.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import {
  createFriendVisibilityIdentifier,
  createFriendVisibilityIdentifiers,
  createGroupVisibilityIdentifiers,
} from '../utils/visibility-utils.js';
import { BaseDAO } from './base-dao.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Data Access Object for Update documents with heavy denormalization handling
 * Manages creator_profile, shared_with_*_profiles, and visibility patterns
 */
export class UpdateDAO extends BaseDAO<UpdateDoc> {
  constructor() {
    super(Collections.UPDATES, updateConverter);
  }

  /**
   * Gets a document reference for an update by ID
   * @param updateId The ID of the update
   * @returns Document reference for the update
   */
  getDocRef(updateId: string): DocumentReference<UpdateDoc> {
    return this.db.collection(this.collection).withConverter(this.converter).doc(updateId);
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
   * Checks if a user has created an update within the specified time period
   * @param userId The user ID to check
   * @param hoursAgo Number of hours to look back (default 24)
   * @returns True if user has recent activity
   */
  async hasRecentActivity(userId: string, hoursAgo: number = 24): Promise<boolean> {
    const cutoffTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    const cutoffTimestamp = Timestamp.fromDate(cutoffTime);

    const recentSnapshot = await this.db
      .collection(this.collection)
      .withConverter(this.converter)
      .where(uf('created_by'), QueryOperators.EQUALS, userId)
      .where(uf('created_at'), QueryOperators.GREATER_THAN, cutoffTimestamp)
      .limit(1)
      .get();

    return !recentSnapshot.empty;
  }

  /**
   * Gets an update by ID with access checking
   * @param updateId The ID of the update
   * @param requestingUserId Optional user ID to check access
   * @returns The update document and reference
   */
  async get(updateId: string, requestingUserId?: string): Promise<{ data: UpdateDoc; ref: DocumentReference } | null> {
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
      this.hasAccess(updateData, requestingUserId);
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
  hasAccess(updateData: UpdateDoc, userId: string): void {
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
  async share(
    updateId: string,
    additionalFriendIds: string[] = [],
    additionalGroupIds: string[] = [],
    additionalFriendsProfiles: UserProfile[] = [],
    additionalGroupsProfiles: GroupProfile[] = [],
    batch?: WriteBatch,
  ): Promise<UpdateDoc> {
    const result = await this.get(updateId);
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
    const docRef = this.db.collection(this.collection).withConverter(this.converter).doc(updateId);
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
    const docRef = this.db.collection(this.collection).withConverter(this.converter).doc(updateId);
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
    const docRef = this.db.collection(this.collection).withConverter(this.converter).doc(updateId);
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
    const docRef = this.db.collection(this.collection).withConverter(this.converter).doc(updateId);
    batch.update(docRef, {
      reaction_count: FieldValue.increment(-1),
      [`reaction_types.${reactionType}`]: FieldValue.increment(-1),
    });
  }

  /**
   * Updates the image analysis field for an update
   * @param updateId The update ID to update
   * @param imageAnalysis The image analysis text to store
   * @param batch Optional WriteBatch to add the operation to
   */
  async updateImageAnalysis(updateId: string, imageAnalysis: string, batch?: WriteBatch): Promise<void> {
    const shouldCommitBatch = !batch;
    const workingBatch = batch || this.db.batch();

    const docRef = this.db.collection(this.collection).withConverter(this.converter).doc(updateId);
    workingBatch.update(docRef, {
      image_analysis: imageAnalysis,
    });

    if (shouldCommitBatch) {
      await workingBatch.commit();
    }
  }

  /**
   * Updates the creator_profile field for an update
   * @param updateId The update ID to update
   * @param newProfile The new creator profile data
   * @param batch Optional WriteBatch to add the operation to
   */
  async updateCreatorProfile(updateId: string, newProfile: CreatorProfile, batch?: WriteBatch): Promise<void> {
    const shouldCommitBatch = !batch;
    const workingBatch = batch || this.db.batch();

    const docRef = this.db.collection(this.collection).withConverter(this.converter).doc(updateId);
    workingBatch.update(docRef, {
      creator_profile: newProfile,
    });

    if (shouldCommitBatch) {
      await workingBatch.commit();
    }

    logger.info(`Updated creator profile for update ${updateId}`);
  }

  /**
   * Updates a specific user's profile in the shared_with_friends_profiles array
   * @param updateId The update ID to update
   * @param userId The user ID whose profile should be updated
   * @param newProfile The new profile data for the user
   * @param batch Optional WriteBatch to add the operation to
   */
  async updateSharedFriendProfile(
    updateId: string,
    userId: string,
    newProfile: UserProfile,
    batch?: WriteBatch,
  ): Promise<void> {
    const shouldCommitBatch = !batch;
    const workingBatch = batch || this.db.batch();

    // Get the current update document to access the shared_with_friends_profiles array
    const result = await this.get(updateId);
    if (!result) {
      throw new NotFoundError(`Update not found: ${updateId}`);
    }

    const { data: updateData } = result;

    // Find and update the specific user's profile in the array
    const updatedProfiles = updateData.shared_with_friends_profiles.map((profile) => {
      if (profile.user_id === userId) {
        return newProfile;
      }
      return profile;
    });

    // Check if the user was found in the array
    const userFound = updateData.shared_with_friends_profiles.some((profile) => profile.user_id === userId);
    if (!userFound) {
      logger.warn(`User ${userId} not found in shared_with_friends_profiles for update ${updateId}`);
      return;
    }

    const docRef = this.db.collection(this.collection).withConverter(this.converter).doc(updateId);
    workingBatch.update(docRef, {
      shared_with_friends_profiles: updatedProfiles,
    });

    if (shouldCommitBatch) {
      await workingBatch.commit();
    }

    logger.info(`Updated shared friend profile for user ${userId} in update ${updateId}`);
  }

  /**
   * Gets all_village updates for a user with streaming support
   * @param userId The creator user ID
   * @returns AsyncIterable of UpdateDoc
   */
  async *streamUpdates(userId: string): AsyncIterable<UpdateDoc> {
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

  /**
   * Streams all updates created by a specific user with streaming support
   * @param userId The creator user ID
   * @returns AsyncIterable of { doc: UpdateDoc, ref: DocumentReference }
   */
  async *streamUpdatesByCreator(userId: string): AsyncIterable<{ doc: UpdateDoc; ref: DocumentReference }> {
    const query = this.db
      .collection(this.collection)
      .withConverter(this.converter)
      .where(uf('created_by'), QueryOperators.EQUALS, userId)
      .orderBy(uf('created_at'), QueryOperators.DESC);

    const stream = query.stream() as AsyncIterable<FirebaseFirestore.QueryDocumentSnapshot<UpdateDoc>>;
    for await (const docSnapshot of stream) {
      const data = docSnapshot.data();
      if (data) {
        yield {
          doc: data,
          ref: docSnapshot.ref,
        };
      }
    }
  }

  /**
   * Streams all updates shared with a specific user with streaming support
   * @param userId The user ID to check for shared updates
   * @returns AsyncIterable of { doc: UpdateDoc, ref: DocumentReference }
   */
  async *streamUpdatesSharedWithUser(userId: string): AsyncIterable<{ doc: UpdateDoc; ref: DocumentReference }> {
    const friendIdentifier = createFriendVisibilityIdentifier(userId);

    const query = this.db
      .collection(this.collection)
      .withConverter(this.converter)
      .where(uf('visible_to'), QueryOperators.ARRAY_CONTAINS, friendIdentifier)
      .orderBy(uf('created_at'), QueryOperators.DESC);

    const stream = query.stream() as AsyncIterable<FirebaseFirestore.QueryDocumentSnapshot<UpdateDoc>>;
    for await (const docSnapshot of stream) {
      const data = docSnapshot.data();
      if (data) {
        yield {
          doc: data,
          ref: docSnapshot.ref,
        };
      }
    }
  }

  /**
   * Removes a user from the visible_to array of an update
   * @param userId The user ID to remove from visible_to
   * @param updateId The update ID to modify
   * @param batch The batch to add the operation to
   */
  removeFromVisibleTo(userId: string, updateId: string, batch: WriteBatch): void {
    const friendIdentifier = createFriendVisibilityIdentifier(userId);
    const docRef = this.db.collection(this.collection).withConverter(this.converter).doc(updateId);

    batch.update(docRef, {
      visible_to: FieldValue.arrayRemove(friendIdentifier),
    });
  }

  /**
   * Updates creator profile denormalization across all updates by a specific user
   * Uses streaming to handle large datasets efficiently with batch operations
   * @param userId The user ID whose updates need profile updates
   * @param newProfile The new creator profile data
   * @returns The count of updated documents
   */
  async updateCreatorProfileDenormalization(userId: string, newProfile: CreatorProfile): Promise<number> {
    logger.info(`Starting creator profile denormalization update for user ${userId}`);

    let updatedCount = 0;
    let currentBatch = this.db.batch();
    let batchOperations = 0;

    try {
      // Stream all updates by the creator
      for await (const { ref } of this.streamUpdatesByCreator(userId)) {
        // Add update operation to batch
        currentBatch.update(ref, {
          creator_profile: newProfile,
        });
        batchOperations++;
        updatedCount++;

        // Commit batch when reaching limit
        if (batchOperations >= MAX_BATCH_OPERATIONS) {
          await currentBatch.commit();
          logger.info(`Committed batch of ${batchOperations} updates for user ${userId}`);

          // Start new batch
          currentBatch = this.db.batch();
          batchOperations = 0;
        }
      }

      // Commit remaining operations
      if (batchOperations > 0) {
        await currentBatch.commit();
        logger.info(`Committed final batch of ${batchOperations} updates for user ${userId}`);
      }

      logger.info(`Successfully updated creator profile for ${updatedCount} updates for user ${userId}`);
      return updatedCount;
    } catch (error) {
      logger.error(`Failed to update creator profile denormalization for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * Updates shared friend profile denormalization across all updates shared with a specific user
   * Uses streaming to handle large datasets efficiently with batch operations
   * @param userId The user ID whose profile needs updating in shared_with_friends_profiles
   * @param userProfile The new user profile data
   * @returns The count of updated documents
   */
  async updateSharedFriendProfileDenormalization(userId: string, userProfile: UserProfile): Promise<number> {
    logger.info(`Starting shared friend profile denormalization update for user ${userId}`);

    let updatedCount = 0;
    let currentBatch = this.db.batch();
    let batchOperations = 0;

    try {
      // Stream all updates shared with the user
      for await (const { doc, ref } of this.streamUpdatesSharedWithUser(userId)) {
        // Find and update the specific user's profile in the shared_with_friends_profiles array
        const updatedProfiles = doc.shared_with_friends_profiles.map((profile) => {
          if (profile.user_id === userId) {
            return userProfile;
          }
          return profile;
        });

        // Check if the user was found in the array
        const userFound = doc.shared_with_friends_profiles.some((profile) => profile.user_id === userId);
        if (!userFound) {
          logger.warn(`User ${userId} not found in shared_with_friends_profiles for update ${doc.id}`);
          continue;
        }

        // Add update operation to batch
        currentBatch.update(ref, {
          shared_with_friends_profiles: updatedProfiles,
        });
        batchOperations++;
        updatedCount++;

        // Commit batch when reaching limit
        if (batchOperations >= MAX_BATCH_OPERATIONS) {
          await currentBatch.commit();
          logger.info(`Committed batch of ${batchOperations} updates for user ${userId}`);

          // Start new batch
          currentBatch = this.db.batch();
          batchOperations = 0;
        }
      }

      // Commit remaining operations
      if (batchOperations > 0) {
        await currentBatch.commit();
        logger.info(`Committed final batch of ${batchOperations} updates for user ${userId}`);
      }

      logger.info(`Successfully updated shared friend profile for ${updatedCount} updates for user ${userId}`);
      return updatedCount;
    } catch (error) {
      logger.error(`Failed to update shared friend profile denormalization for user ${userId}`, error);
      throw error;
    }
  }
}
