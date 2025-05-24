import { Request } from 'express';
import { DocumentData, getFirestore, UpdateData } from 'firebase-admin/firestore';
import { ApiResponse, EventName, ReactionEventParams } from '../models/analytics-events.js';
import { Collections, ReactionFields } from '../models/constants.js';
import { ReactionGroup } from '../models/data-models.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { getUpdateDoc, hasUpdateAccess } from '../utils/update-utils.js';

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Deletes a reaction from an update.
 *
 * This function:
 * 1. Verifies the user has access to update
 * 2. Verifies the user created the reaction
 * 3. Deletes reaction document
 * 4. Updates the reaction count on the update document
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Route parameters containing:
 *                - update_id: The ID of the update
 *                - reaction_id: The ID of the reaction to delete
 *
 * @returns An ApiResponse containing the reaction group and analytics
 *
 * @throws 404: Update or reaction not found
 * @throws 403: You don't have access to this update, or you can only delete your own reactions
 */
export const deleteReaction = async (req: Request): Promise<ApiResponse<ReactionGroup>> => {
  const currentUserId = req.userId;
  const updateId = req.params.update_id;
  const reactionId = req.params.reaction_id;

  logger.info(`Deleting reaction ${reactionId} from update ${updateId} by user ${currentUserId}`);

  const db = getFirestore();

  if (!updateId) {
    throw new BadRequestError('Update ID is required');
  }

  if (!reactionId) {
    throw new BadRequestError('Reaction ID is required');
  }

  // Get the update document and verify access
  const updateResult = await getUpdateDoc(updateId);
  hasUpdateAccess(updateResult.data, currentUserId);

  // Get the reaction document
  const reactionRef = updateResult.ref.collection(Collections.REACTIONS).doc(reactionId);
  const reactionDoc = await reactionRef.get();

  if (!reactionDoc.exists) {
    logger.warn(`Reaction ${reactionId} not found on update ${updateId}`);
    throw new NotFoundError('Reaction not found');
  }

  const reactionData = reactionDoc.data();
  if (reactionData?.[ReactionFields.CREATED_BY] !== currentUserId) {
    logger.warn(
      `User ${currentUserId} attempted to delete reaction created by ${reactionData?.[ReactionFields.CREATED_BY]}`,
    );
    throw new ForbiddenError('You can only delete your own reactions');
  }

  // Create a batch for atomic operations
  const batch = db.batch();

  // Delete the reaction document
  batch.delete(reactionRef);

  // Update the reaction count
  const updateCountData: UpdateData<DocumentData> = {
    reaction_count: Math.max(0, (updateResult.data.reaction_count || 0) - 1),
  };
  batch.update(updateResult.ref, updateCountData);

  // Commit the batch
  await batch.commit();
  logger.info(`Successfully deleted reaction ${reactionId} from update ${updateId}`);

  // Return the reaction group with the updated count
  const response: ReactionGroup = {
    type: reactionData?.[ReactionFields.TYPE] || '',
    count: Math.max(0, (updateResult.data.reaction_count || 0) - 1),
    reaction_id: reactionId,
  };

  // Create analytics event
  const event: ReactionEventParams = {
    reaction_count: Math.max(0, (updateResult.data.reaction_count || 0) - 1),
    comment_count: updateResult.data.comment_count || 0,
  };

  return {
    data: response,
    status: 200,
    analytics: {
      event: EventName.REACTION_DELETED,
      userId: currentUserId,
      params: event,
    },
  };
};
