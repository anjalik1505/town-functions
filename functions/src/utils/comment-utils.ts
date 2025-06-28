import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { Collections } from '../models/constants.js';
import { CommentDoc, commentConverter } from '../models/firestore/comment-doc.js';
import { Comment } from '../models/data-models.js';
import { NotFoundError } from './errors.js';
import { getLogger } from './logging-utils.js';
import { formatTimestamp } from './timestamp-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Format a comment document into a standard Comment object
 * @param commentId The ID of the comment
 * @param commentData The comment document data
 * @param createdBy The ID of the user who created the comment
 * @returns A formatted Comment object
 */
export const formatComment = (commentId: string, commentData: CommentDoc, createdBy: string): Comment => {
  return {
    comment_id: commentId,
    created_by: createdBy,
    content: commentData.content || '',
    created_at: formatTimestamp(commentData.created_at),
    updated_at: formatTimestamp(commentData.updated_at),
    username: '', // Will be populated from profile
    name: '', // Will be populated from profile
    avatar: '', // Will be populated from profile
  };
};

/**
 * Format a comment document into a Comment object with user profile information
 * @param commentId The ID of the comment
 * @param commentData The comment document data
 * @param createdBy The ID of the user who created the comment
 * @returns A formatted Comment object with profile data
 */
export const formatEnrichedComment = (commentId: string, commentData: CommentDoc, createdBy: string): Comment => {
  const comment = formatComment(commentId, commentData, createdBy);

  // Always include profile data, using empty strings if missing
  const commenterProfile = commentData.commenter_profile;
  comment.username = commenterProfile.username || '';
  comment.name = commenterProfile.name || '';
  comment.avatar = commenterProfile.avatar || '';

  return comment;
};

/**
 * Process comment documents and create enriched comment objects with user profile information
 * using denormalized commenter_profile data
 * @param commentDocs Array of comment document snapshots
 * @returns Array of formatted Comment objects with profile data
 */
export const processEnrichedComments = (commentDocs: QueryDocumentSnapshot<CommentDoc>[]): Comment[] => {
  return commentDocs
    .map((commentDoc) => {
      const commentData = commentDoc.data();
      const createdBy = commentData.created_by || '';

      return formatEnrichedComment(commentDoc.id, commentData, createdBy);
    })
    .filter((comment): comment is Comment => comment !== null);
};

/**
 * Get a comment document by ID
 * @param updateId The ID of the update
 * @param commentId The ID of the comment
 * @returns The comment document and data, or null if not found
 * @throws NotFoundError if the comment doesn't exist
 */
export const getCommentDoc = async (
  updateId: string,
  commentId: string,
): Promise<{
  ref: FirebaseFirestore.DocumentReference<CommentDoc>;
  data: CommentDoc;
}> => {
  const db = getFirestore();
  const updateRef = db.collection(Collections.UPDATES).doc(updateId);
  const commentRef = updateRef.collection(Collections.COMMENTS).withConverter(commentConverter).doc(commentId);
  const commentDoc = await commentRef.get();

  if (!commentDoc.exists) {
    logger.warn(`Comment not found: ${commentId}`);
    throw new NotFoundError('Comment not found');
  }

  const data = commentDoc.data();
  if (!data) {
    throw new NotFoundError('Comment data not found');
  }

  return {
    ref: commentRef,
    data,
  };
};
