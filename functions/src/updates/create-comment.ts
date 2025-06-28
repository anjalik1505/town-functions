import { Request } from 'express';
import { DocumentData, getFirestore, Timestamp, UpdateData } from 'firebase-admin/firestore';
import { ApiResponse, CommentEventParams, EventName } from '../models/analytics-events.js';
import { Collections } from '../models/constants.js';
import { CommentDoc, commentConverter } from '../models/firestore/comment-doc.js';
import { Comment, CreateCommentPayload } from '../models/data-models.js';
import { formatComment } from '../utils/comment-utils.js';
import { BadRequestError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { getProfileDoc } from '../utils/profile-utils.js';
import { getUpdateDoc, hasUpdateAccess } from '../utils/update-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Creates a new comment on an update.
 *
 * This function:
 * 1. Verifies the user has access to the update using visibility identifiers
 * 2. Fetches the commenter's profile for denormalization
 * 3. Creates a new comment document with denormalized profile data
 * 4. Updates the comment count on update
 * 5. Returns the created comment with profile data
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Comment data containing:
 *                - content: The comment text
 *              - params: Route parameters containing:
 *                - update_id: The ID of the update to comment on
 *
 * @returns An ApiResponse containing the created comment and analytics
 *
 * @throws 400: Invalid request parameters
 * @throws 403: You don't have access to this update
 * @throws 404: Update not found
 */
export const createComment = async (req: Request): Promise<ApiResponse<Comment>> => {
  const updateId = req.params.update_id;
  const currentUserId = req.userId;
  logger.info(`Creating comment on update: ${updateId}`);

  const db = getFirestore();

  if (!updateId) {
    throw new BadRequestError('Update ID is required');
  }

  const validatedData = req.validated_params as CreateCommentPayload;

  // Get the update document to check access
  const updateResult = await getUpdateDoc(updateId);
  const updateData = updateResult.data;
  hasUpdateAccess(updateData, currentUserId);

  // Get the commenter's profile to store with the comment
  const { data: profileData } = await getProfileDoc(currentUserId);

  // Create the comment with denormalized profile data
  const commentData: Omit<CommentDoc, 'id'> = {
    created_by: currentUserId,
    content: validatedData.content,
    created_at: Timestamp.now(),
    updated_at: Timestamp.now(),
    parent_id: null,
    commenter_profile: {
      username: profileData.username || '',
      name: profileData.name || '',
      avatar: profileData.avatar || '',
    },
  };

  // Create comment and update comment count in a batch
  const batch = db.batch();
  const commentRef = updateResult.ref.collection(Collections.COMMENTS).withConverter(commentConverter).doc();
  batch.set(commentRef, { ...commentData, id: commentRef.id });

  const updateCountData: UpdateData<DocumentData> = {
    comment_count: (updateData.comment_count || 0) + 1,
  };
  batch.update(updateResult.ref, updateCountData);

  await batch.commit();

  // Get the created comment
  const commentDoc = await commentRef.get();
  const commentDocData = commentDoc.data();

  if (!commentDocData) {
    throw new Error('Failed to retrieve created comment');
  }

  const comment = formatComment(commentRef.id, commentDocData, currentUserId);
  // Use the denormalized profile data from the comment document
  const commenterProfile = commentDocData.commenter_profile;
  comment.username = commenterProfile.username || '';
  comment.name = commenterProfile.name || '';
  comment.avatar = commenterProfile.avatar || '';

  // Create an analytics event with the updated comment count
  const event: CommentEventParams = {
    comment_length: validatedData.content.length,
    comment_count: (updateData.comment_count || 0) + 1,
    reaction_count: updateData.reaction_count || 0,
  };

  return {
    data: comment,
    status: 201,
    analytics: {
      event: EventName.COMMENT_CREATED,
      userId: currentUserId,
      params: event,
    },
  };
};
