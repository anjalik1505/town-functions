import { DocumentReference, Timestamp, WriteBatch } from 'firebase-admin/firestore';
import { Collections, QueryOperators } from '../models/constants.js';
import { cf, commentConverter, CommentDoc, CreatorProfile } from '../models/firestore/index.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';
import { applyPagination, generateNextCursor, processQueryStream } from '../utils/pagination-utils.js';
import { getProfileDoc } from '../utils/profile-utils.js';
import { BaseDAO } from './base-dao.js';

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
  async updateComment(
    updateRef: DocumentReference,
    commentId: string,
    content: string,
    userId: string,
  ): Promise<CommentDoc> {
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
  async deleteComment(
    updateRef: DocumentReference,
    commentId: string,
    userId: string,
    batch?: WriteBatch,
  ): Promise<void> {
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
}
