import { Request } from 'express';
import { FieldValue, getFirestore, UpdateData } from 'firebase-admin/firestore';
import { ApiResponse, EventName, ReactionEventParams } from '../models/analytics-events.js';
import { Collections } from '../models/constants.js';
import { ReactionGroup } from '../models/data-models.js';
import { UpdateDoc } from '../models/firestore/index.js';
import { ReactionDoc, reactionConverter } from '../models/firestore/reaction-doc.js';
import { BadRequestError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { getUpdateDoc, hasUpdateAccess } from '../utils/update-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Deletes a reaction from an update.
 *
 * This function:
 * 1. Verifies the user has access to update
 * 2. Finds the user's reaction document
 * 3. Removes the specified reaction type from the document
 * 4. Updates the reaction count on the update document
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Route parameters containing:
 *                - update_id: The ID of the update
 *              - validated_params: Request body containing:
 *                - type: The type of reaction to delete
 *
 * @returns An ApiResponse containing the reaction summary and analytics
 *
 * @throws 400: Reaction type not found
 * @throws 404: Update not found
 * @throws 403: You don't have access to this update
 */
export const deleteReaction = async (req: Request): Promise<ApiResponse<ReactionGroup>> => {
  const currentUserId = req.userId;
  const updateId = req.params.update_id;
  const validatedParams = req.validated_params as { type: string };
  const reactionType = validatedParams.type;

  logger.info(`Deleting reaction type ${reactionType} from update ${updateId} by user ${currentUserId}`);

  const db = getFirestore();

  if (!updateId) {
    throw new BadRequestError('Update ID is required');
  }

  // Get the update document and verify access
  const updateResult = await getUpdateDoc(updateId);
  await hasUpdateAccess(updateResult.data, currentUserId);

  // Get the user's reaction document
  const reactionRef = updateResult.ref
    .collection(Collections.REACTIONS)
    .withConverter(reactionConverter)
    .doc(currentUserId);
  const reactionDoc = await reactionRef.get();

  if (!reactionDoc.exists) {
    logger.warn(`No reactions found for user ${currentUserId} on update ${updateId}`);
    throw new BadRequestError('Reaction not found');
  }

  const reactionData = reactionDoc.data();
  if (!reactionData) {
    throw new BadRequestError('Reaction data not found');
  }

  const types = reactionData.types || [];

  if (!types.includes(reactionType)) {
    logger.warn(`Reaction type ${reactionType} not found for user ${currentUserId} on update ${updateId}`);
    throw new BadRequestError('Reaction type not found');
  }

  // Create a batch for atomic operations
  const batch = db.batch();

  // Update the reaction document to remove the type
  const updatedTypes = types.filter((t) => t !== reactionType);

  if (updatedTypes.length > 0) {
    // Update the document with remaining types
    batch.update(reactionRef, {
      types: FieldValue.arrayRemove(reactionType),
      updated_at: FieldValue.serverTimestamp(),
    } as UpdateData<ReactionDoc>);
  } else {
    // Delete the document if no types remain
    batch.delete(reactionRef);
  }

  // Get current reaction summary
  const updateData = updateResult.data as UpdateDoc;
  const currentSummary = updateData.reaction_types || {};
  const currentTypeCount = currentSummary[reactionType] || 0;
  const newPerTypeCount = Math.max(0, currentTypeCount - 1);

  // Prepare the update data for reaction summary
  const updateFieldData: UpdateData<UpdateDoc> = {
    reaction_count: FieldValue.increment(-1),
    [`reaction_types.${reactionType}`]: FieldValue.increment(-1),
  };

  // Update the update document
  batch.update(updateResult.ref, updateFieldData);

  // Commit the batch
  await batch.commit();
  logger.info(`Successfully deleted reaction type ${reactionType} from update ${updateId}`);

  // Return the reaction summary with the updated count
  const response: ReactionGroup = {
    type: reactionType,
    count: newPerTypeCount,
  };

  // Calculate new total reaction count
  const newReactionCount = Math.max(0, (updateData.reaction_count || 0) - 1);

  // Create analytics event
  const event: ReactionEventParams = {
    reaction_count: newReactionCount,
    comment_count: updateData.comment_count || 0,
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
