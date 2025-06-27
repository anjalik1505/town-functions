import { Request } from 'express';
import { DocumentData, FieldValue, getFirestore, Timestamp, UpdateData } from 'firebase-admin/firestore';
import { ApiResponse, EventName, ReactionEventParams } from '../models/analytics-events.js';
import { Collections, QueryOperators, ReactionFields, UpdateFields } from '../models/constants.js';
import { CreateReactionPayload, ReactionGroup } from '../models/data-models.js';
import { BadRequestError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { getUpdateDoc, hasUpdateAccess } from '../utils/update-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Creates a new reaction on an update.
 *
 * This function:
 * 1. Verifies the user has access to update
 * 2. Checks if the user has already reacted with this type
 * 3. Creates a new reaction in reactions subcollection
 * 4. Updates the reaction count on the update document
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: The validated request data containing:
 *                - type: The type of reaction (e.g., "like", "love", "laugh")
 *              - params: Route parameters containing:
 *                - update_id: The ID of the update to react to
 *
 * @returns An ApiResponse containing the reaction group and analytics
 *
 * @throws 400: You have already reacted with this type
 * @throws 403: You don't have access to this update
 * @throws 404: Update not found
 */
export const createReaction = async (req: Request): Promise<ApiResponse<ReactionGroup>> => {
  const currentUserId = req.userId;
  const updateId = req.params.update_id;
  const validatedData = req.validated_params as CreateReactionPayload;
  const reactionType = validatedData.type;

  logger.info(`Creating ${reactionType} reaction on update ${updateId} by user ${currentUserId}`);

  const db = getFirestore();

  if (!updateId) {
    throw new BadRequestError('Update ID is required');
  }

  // Get the update document and verify access
  const updateResult = await getUpdateDoc(updateId);
  await hasUpdateAccess(updateResult.data, currentUserId);

  // Check if a user has already reacted with this type
  const existingReactionSnapshot = await updateResult.ref
    .collection(Collections.REACTIONS)
    .where(ReactionFields.CREATED_BY, QueryOperators.EQUALS, currentUserId)
    .where(ReactionFields.TYPE, QueryOperators.EQUALS, reactionType)
    .get();

  if (!existingReactionSnapshot.empty) {
    logger.warn(`User ${currentUserId} attempted to create duplicate ${reactionType} reaction on update ${updateId}`);
    throw new BadRequestError('You have already reacted with this type');
  }

  // Create the reaction document
  const createdAt = Timestamp.now();

  const reactionData: UpdateData<DocumentData> = {
    [ReactionFields.CREATED_BY]: currentUserId,
    [ReactionFields.TYPE]: reactionType,
    [ReactionFields.CREATED_AT]: createdAt,
  };

  // Create a batch for atomic operations
  const batch = db.batch();
  const reactionRef = updateResult.ref.collection(Collections.REACTIONS).doc();
  const reactionId = reactionRef.id;

  // Add the reaction document
  batch.set(reactionRef, reactionData);

  // Get current reaction summary to update recent_reactors
  const currentTypes = updateResult.data[UpdateFields.REACTION_TYPES] || {};

  // Prepare the update data for reaction summary
  const updateData: UpdateData<DocumentData> = {
    [UpdateFields.REACTION_COUNT]: FieldValue.increment(1),
    [UpdateFields.REACTION_TYPES]: {
      ...currentTypes,
      [reactionType]: (currentTypes[reactionType] || 0) + 1,
    },
  };

  // Update the update document
  batch.update(updateResult.ref, updateData);

  // Commit the batch
  await batch.commit();
  logger.info(`Successfully created reaction ${reactionId} on update ${updateId}`);

  // Return the reaction group with an updated count
  const newReactionCount = (updateResult.data[UpdateFields.REACTION_COUNT] || 0) + 1;
  const response: ReactionGroup = {
    type: reactionType,
    count: newReactionCount,
    reaction_id: reactionId,
  };

  // Create analytics event
  const event: ReactionEventParams = {
    reaction_count: newReactionCount,
    comment_count: updateResult.data[UpdateFields.COMMENT_COUNT] || 0,
  };

  return {
    data: response,
    status: 201,
    analytics: {
      event: EventName.REACTION_CREATED,
      userId: currentUserId,
      params: event,
    },
  };
};
