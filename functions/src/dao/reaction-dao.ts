import { DocumentData, DocumentReference, FieldValue, Timestamp, WriteBatch } from 'firebase-admin/firestore';
import { Collections } from '../models/constants.js';
import { ReactionDoc, reactionConverter } from '../models/firestore/index.js';
import { BadRequestError } from '../utils/errors.js';
import { BaseDAO } from './base-dao.js';

/**
 * Data Access Object for Reaction documents in updates subcollection
 * Manages reactions with multiple types per user and atomic counter updates
 * Document ID = userId for efficient lookups
 */
export class ReactionDAO extends BaseDAO<ReactionDoc> {
  constructor() {
    super(Collections.REACTIONS, reactionConverter);
  }

  /**
   * Upserts a reaction (creates or adds to existing types)
   * @param updateRef The reference to the parent update document
   * @param userId The ID of the user creating the reaction
   * @param reactionType The type of reaction to add
   * @param batch Optional batch to include this operation in
   * @returns The complete reaction document
   */
  async upsert(
    updateRef: DocumentReference,
    userId: string,
    reactionType: string,
    batch?: WriteBatch,
  ): Promise<ReactionDoc> {
    const reactionRef = updateRef.collection(this.collection).withConverter(this.converter).doc(userId);
    const reactionDoc = await reactionRef.get();

    const existingTypes: string[] = reactionDoc.exists ? (reactionDoc.data()?.types ?? []) : [];
    const existingData = reactionDoc.exists ? reactionDoc.data() : null;

    // Check if the reaction type already exists
    if (existingTypes.includes(reactionType)) {
      throw new BadRequestError('You have already reacted with this type');
    }

    const shouldCommitBatch = !batch;
    const workingBatch = batch || this.db.batch();
    const now = Timestamp.now();

    // Update or create the reaction document
    const reactionUpdate: DocumentData = {
      types: FieldValue.arrayUnion(reactionType),
      updated_at: now,
    };

    // Include created_by and created_at only if this is a new document
    if (!reactionDoc.exists) {
      reactionUpdate.created_by = userId;
      reactionUpdate.created_at = now;
    }

    workingBatch.set(reactionRef, reactionUpdate, { merge: true });

    if (shouldCommitBatch) {
      await workingBatch.commit();
    }

    // Return the complete reaction document
    const updatedTypes = [...existingTypes, reactionType];
    return {
      created_by: existingData?.created_by || userId,
      created_at: existingData?.created_at || now,
      updated_at: now,
      types: updatedTypes,
    } as ReactionDoc;
  }

  /**
   * Removes a specific reaction type from a user's reactions
   * @param updateRef The reference to the parent update document
   * @param userId The ID of the user removing the reaction
   * @param reactionType The type of reaction to remove
   * @param batch Optional batch to include this operation in
   * @returns The updated reaction types array
   */
  async delete(
    updateRef: DocumentReference,
    userId: string,
    reactionType: string,
    batch?: WriteBatch,
  ): Promise<string[]> {
    const reactionRef = updateRef.collection(this.collection).withConverter(this.converter).doc(userId);
    const reactionDoc = await reactionRef.get();

    if (!reactionDoc.exists) {
      throw new BadRequestError('Reaction type not found');
    }

    const reactionData = reactionDoc.data();
    if (!reactionData) {
      throw new BadRequestError('Reaction type not found');
    }

    const existingTypes = reactionData.types || [];

    // Check if the reaction type exists
    if (!existingTypes.includes(reactionType)) {
      throw new BadRequestError('Reaction type not found');
    }

    const shouldCommitBatch = !batch;
    const workingBatch = batch || this.db.batch();

    // Remove the reaction type from the array
    workingBatch.update(reactionRef, {
      types: FieldValue.arrayRemove(reactionType),
      updated_at: Timestamp.now(),
    });

    const updatedTypes = existingTypes.filter((type) => type !== reactionType);

    // If no reaction types left, delete the reaction document
    if (updatedTypes.length === 0) {
      workingBatch.delete(reactionRef);
    }

    if (shouldCommitBatch) {
      await workingBatch.commit();
    }

    return updatedTypes;
  }
}
