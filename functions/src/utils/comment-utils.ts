import { getFirestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { Collections, CommentFields } from '../models/constants.js';
import { Comment } from '../models/data-models.js';
import { NotFoundError } from './errors.js';
import { getLogger } from './logging-utils.js';
import { enrichWithProfile } from './profile-utils.js';
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
export const formatComment = (
  commentId: string,
  commentData: FirebaseFirestore.DocumentData,
  createdBy: string,
): Comment => {
  return {
    comment_id: commentId,
    created_by: createdBy,
    content: commentData[CommentFields.CONTENT] || '',
    created_at: formatTimestamp(commentData[CommentFields.CREATED_AT]),
    updated_at: formatTimestamp(commentData[CommentFields.UPDATED_AT]),
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
 * @param profile Optional profile data for the creator
 * @returns A formatted Comment object with profile data
 */
export const formatEnrichedComment = (
  commentId: string,
  commentData: FirebaseFirestore.DocumentData,
  createdBy: string,
  profile: { username: string; name: string; avatar: string } | null = null,
): Comment => {
  const comment = formatComment(commentId, commentData, createdBy);
  return enrichWithProfile(comment, profile);
};

/**
 * Process comment documents and create enriched comment objects with user profile information
 * @param commentDocs Array of comment document snapshots
 * @param profiles Map of user IDs to profile data
 * @returns Array of formatted Comment objects with profile data
 */
export const processEnrichedComments = (
  commentDocs: QueryDocumentSnapshot[],
  profiles: Map<string, { username: string; name: string; avatar: string }>,
): Comment[] => {
  return commentDocs
    .map((commentDoc) => {
      const commentData = commentDoc.data();
      const createdBy = commentData[CommentFields.CREATED_BY] || '';

      return formatEnrichedComment(commentDoc.id, commentData, createdBy, profiles.get(createdBy) || null);
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
  ref: FirebaseFirestore.DocumentReference;
  data: FirebaseFirestore.DocumentData;
}> => {
  const db = getFirestore();
  const updateRef = db.collection(Collections.UPDATES).doc(updateId);
  const commentRef = updateRef.collection(Collections.COMMENTS).doc(commentId);
  const commentDoc = await commentRef.get();

  if (!commentDoc.exists) {
    logger.warn(`Comment not found: ${commentId}`);
    throw new NotFoundError('Comment not found');
  }

  return {
    ref: commentRef,
    data: commentDoc.data() || {},
  };
};
