import { DocumentReference, Timestamp, WriteBatch } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { Collections, QueryOperators, MAX_BATCH_OPERATIONS } from '../models/constants.js';
import { cf, commentConverter, CommentDoc, CreatorProfile } from '../models/firestore/index.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { applyPagination, generateNextCursor, processQueryStream } from '../utils/pagination-utils.js';
import { getProfileDoc } from '../utils/profile-utils.js';
import { BaseDAO } from './base-dao.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Data Access Object for Comment documents in updates subcollection
 * Manages comments with commenter profile denormalization and count management
 */
export class CommentDAO extends BaseDAO<CommentDoc> {
  constructor() {
    super(Collections.COMMENTS, commentConverter);
  }

  /**
   * Creates a new comment with profile denormalization and count management
   * @param updateRef The reference to the parent update document
   * @param commentData The comment data to create
   * @param commenterId The ID of the user creating the comment
   * @param batch Optional batch to include this operation in
   * @returns The created comment with its ID
   */
  async create(
    updateRef: DocumentReference,
    commentData: Omit<CommentDoc, 'id' | 'commenter_profile'>,
    commenterId: string,
    batch?: WriteBatch,
  ): Promise<{ id: string; data: CommentDoc }> {
    // Fetch commenter's profile for denormalization
    const { data: profileData } = await getProfileDoc(commenterId);

    const commenterProfile: CreatorProfile = {
      username: profileData.username || '',
      name: profileData.name || '',
      avatar: profileData.avatar || '',
    };

    const commentRef = updateRef.collection(this.collection).withConverter(this.converter).doc();
    const commentId = commentRef.id;

    const fullCommentData: CommentDoc = {
      ...commentData,
      id: commentId,
      created_by: commenterId,
      commenter_profile: commenterProfile,
      created_at: Timestamp.now(),
      updated_at: Timestamp.now(),
    };

    const shouldCommitBatch = !batch;
    const workingBatch = batch || this.db.batch();

    // Create the comment
    workingBatch.set(commentRef, fullCommentData);

    if (shouldCommitBatch) {
      await workingBatch.commit();
    }

    return { id: commentId, data: fullCommentData };
  }

  /**
   * Updates a comment's content and updated_at timestamp
   * @param updateRef The reference to the parent update document
   * @param commentId The ID of the comment to update
   * @param content The new content for the comment
   * @param userId The ID of the user updating the comment
   * @returns The updated comment document
   */
  async update(updateRef: DocumentReference, commentId: string, content: string, userId: string): Promise<CommentDoc> {
    const commentRef = updateRef.collection(this.collection).withConverter(this.converter).doc(commentId);
    const commentDoc = await commentRef.get();

    if (!commentDoc.exists) {
      throw new NotFoundError('Comment not found');
    }

    const commentData = commentDoc.data();
    if (!commentData) {
      throw new NotFoundError('Comment not found');
    }

    if (commentData.created_by !== userId) {
      throw new ForbiddenError('You can only update your own comments');
    }

    const now = Timestamp.now();

    const updateData = {
      content,
      updated_at: now,
    };

    await commentRef.update(updateData);

    // Return updated comment data
    return {
      ...commentData,
      content,
      updated_at: now,
    };
  }

  /**
   * Deletes a comment and decrements the comment count
   * @param updateRef The reference to the parent update document
   * @param commentId The ID of the comment to delete
   * @param userId The ID of the user deleting the comment
   * @param batch Optional batch to include this operation in
   */
  async delete(updateRef: DocumentReference, commentId: string, userId: string, batch?: WriteBatch): Promise<void> {
    const commentRef = updateRef.collection(this.collection).withConverter(this.converter).doc(commentId);
    const commentDoc = await commentRef.get();

    if (!commentDoc.exists) {
      throw new NotFoundError('Comment not found');
    }

    const commentData = commentDoc.data();
    if (!commentData) {
      throw new NotFoundError('Comment not found');
    }

    if (commentData.created_by !== userId) {
      throw new ForbiddenError('You can only delete your own comments');
    }

    const shouldCommitBatch = !batch;
    const workingBatch = batch || this.db.batch();

    // Delete the comment
    workingBatch.delete(commentRef);

    if (shouldCommitBatch) {
      await workingBatch.commit();
    }
  }

  /**
   * Gets comments for an update with pagination
   * @param updateRef The reference to the parent update document
   * @param limit Number of comments to retrieve
   * @param afterCursor Optional cursor for pagination
   * @returns Paginated comments and next cursor
   */
  async getComments(
    updateRef: DocumentReference,
    limit: number = 20,
    afterCursor?: string,
  ): Promise<{ comments: CommentDoc[]; nextCursor: string | null }> {
    let query = updateRef
      .collection(this.collection)
      .withConverter(this.converter)
      .orderBy(cf('created_at'), QueryOperators.DESC);

    // Apply pagination
    const paginatedQuery = await applyPagination(query, afterCursor, limit);

    // Process the query stream
    const { items, lastDoc } = await processQueryStream(paginatedQuery, (doc) => doc.data()! as CommentDoc, limit);

    // Generate next cursor
    const nextCursor = generateNextCursor(lastDoc, items.length, limit);

    return {
      comments: items,
      nextCursor,
    };
  }

  /**
   * Gets all comments created by a specific user across all updates
   * @param userId The ID of the user whose comments to retrieve
   * @returns Array of comments created by the user
   */
  async getByUser(userId: string): Promise<CommentDoc[]> {
    logger.info(`Getting comments for user: ${userId}`);

    try {
      // First, get all updates collection
      const updatesRef = this.db.collection(Collections.UPDATES);
      const updatesSnapshot = await updatesRef.get();

      const allComments: CommentDoc[] = [];

      // For each update, query its comments subcollection for this user
      for (const updateDoc of updatesSnapshot.docs) {
        const commentsRef = updateDoc.ref
          .collection(this.collection)
          .withConverter(this.converter)
          .where(cf('created_by'), QueryOperators.EQUALS, userId);

        const commentsSnapshot = await commentsRef.get();

        for (const commentDoc of commentsSnapshot.docs) {
          const commentData = commentDoc.data();
          if (commentData) {
            allComments.push(commentData);
          }
        }
      }

      // Sort by creation date (newest first)
      allComments.sort((a, b) => b.created_at.toMillis() - a.created_at.toMillis());

      logger.info(`Found ${allComments.length} comments for user ${userId}`);
      return allComments;
    } catch (error) {
      logger.error(`Failed to get comments for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * Streams all comments created by a specific user across all updates
   * Uses collection group query for efficient searching across all comment subcollections
   * @param userId The ID of the user whose comments to stream
   * @returns AsyncIterable of { comment: CommentDoc, updateRef: DocumentReference, commentRef: DocumentReference }
   */
  async *streamCommentsByUser(
    userId: string,
  ): AsyncIterable<{ comment: CommentDoc; updateRef: DocumentReference; commentRef: DocumentReference }> {
    logger.info(`Streaming comments for user: ${userId}`);

    try {
      // Use collection group query to search across all comment subcollections
      const query = this.db
        .collectionGroup(this.collection)
        .withConverter(this.converter)
        .where(cf('created_by'), QueryOperators.EQUALS, userId)
        .orderBy(cf('created_at'), QueryOperators.DESC);

      // Stream the query results
      const stream = query.stream() as AsyncIterable<FirebaseFirestore.QueryDocumentSnapshot<CommentDoc>>;

      for await (const docSnapshot of stream) {
        const commentData = docSnapshot.data();
        if (commentData) {
          // Extract the parent update reference from the document reference path
          // Path structure: /updates/{updateId}/comments/{commentId}
          const updateRef = docSnapshot.ref.parent.parent;
          if (updateRef) {
            yield {
              comment: commentData,
              updateRef: updateRef,
              commentRef: docSnapshot.ref,
            };
          } else {
            logger.warn(`Could not extract update reference from comment document path: ${docSnapshot.ref.path}`);
          }
        }
      }

      logger.info(`Successfully streamed comments for user ${userId}`);
    } catch (error) {
      logger.error(`Failed to stream comments for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * Updates the commenter profile fields in a specific comment document
   * @param updateRef The reference to the parent update document
   * @param commentId The ID of the comment to update
   * @param newProfile The new profile data to update
   * @param batch Optional batch to include this operation in
   */
  async updateCommenterProfile(
    updateRef: DocumentReference,
    commentId: string,
    newProfile: CreatorProfile,
    batch?: WriteBatch,
  ): Promise<void> {
    logger.info(`Updating commenter profile for comment ${commentId}`);

    try {
      const commentRef = updateRef.collection(this.collection).withConverter(this.converter).doc(commentId);
      const commentDoc = await commentRef.get();

      if (!commentDoc.exists) {
        throw new NotFoundError(`Comment ${commentId} not found`);
      }

      const commentData = commentDoc.data();
      if (!commentData) {
        throw new NotFoundError(`Comment ${commentId} not found`);
      }

      const shouldCommitBatch = !batch;
      const workingBatch = batch || this.db.batch();

      const updateData = {
        commenter_profile: newProfile,
        updated_at: Timestamp.now(),
      };

      workingBatch.update(commentRef, updateData);

      if (shouldCommitBatch) {
        await workingBatch.commit();
      }

      logger.info(`Successfully updated commenter profile for comment ${commentId}`);
    } catch (error) {
      logger.error(`Failed to update commenter profile for comment ${commentId}`, error);
      throw error;
    }
  }

  /**
   * Updates commenter profile denormalization across all comments by a specific user
   * Uses streaming to handle large datasets efficiently with batch operations
   * @param userId The user ID whose comments need profile updates
   * @param newProfile The new creator profile data
   * @returns The count of updated documents
   */
  async updateCommenterProfileDenormalization(userId: string, newProfile: CreatorProfile): Promise<number> {
    logger.info(`Starting commenter profile denormalization update for user ${userId}`);

    let updatedCount = 0;
    let currentBatch = this.db.batch();
    let batchOperations = 0;

    try {
      // Stream all comments by the user
      for await (const { commentRef } of this.streamCommentsByUser(userId)) {
        // Add update operation to batch
        currentBatch.update(commentRef, {
          commenter_profile: newProfile,
          updated_at: Timestamp.now(),
        });
        batchOperations++;
        updatedCount++;

        // Commit batch when reaching limit
        if (batchOperations >= MAX_BATCH_OPERATIONS) {
          await currentBatch.commit();
          logger.info(`Committed batch of ${batchOperations} comments for user ${userId}`);

          // Start new batch
          currentBatch = this.db.batch();
          batchOperations = 0;
        }
      }

      // Commit remaining operations
      if (batchOperations > 0) {
        await currentBatch.commit();
        logger.info(`Committed final batch of ${batchOperations} comments for user ${userId}`);
      }

      logger.info(`Successfully updated commenter profile for ${updatedCount} comments for user ${userId}`);
      return updatedCount;
    } catch (error) {
      logger.error(`Failed to update commenter profile denormalization for user ${userId}`, error);
      throw error;
    }
  }
}
