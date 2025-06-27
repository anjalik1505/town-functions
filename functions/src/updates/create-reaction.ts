import { Request } from 'express';
import { DocumentData, FieldValue, getFirestore, Timestamp, UpdateData } from 'firebase-admin/firestore';
import { ApiResponse, EventName, ReactionEventParams } from '../models/analytics-events.js';
import { Collections, ReactionFields, UpdateFields } from '../models/constants.js';
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
 * 3. Creates or updates the user's reaction document in reactions subcollection
 * 4. Increments the total reaction count and per-type count on the update document
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: The validated request data containing:
 *                - type: The type of reaction (e.g., "like", "love", "laugh")
 *              - params: Route parameters containing:
 *                - update_id: The ID of the update to react to
 *
 * @returns An ApiResponse containing the reaction summary and analytics
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

  // Look up the user's reaction document by userId
  const reactionRef = updateResult.ref.collection(Collections.REACTIONS).doc(currentUserId);
  const reactionSnap = await reactionRef.get();

  // Get existing types array from the document
  const existingTypes: string[] = reactionSnap.exists ? (reactionSnap.data()?.[ReactionFields.TYPES] ?? []) : [];

  // Check if the reaction type already exists
  if (existingTypes.includes(reactionType)) {
    logger.warn(`User ${currentUserId} attempted to create duplicate ${reactionType} reaction on update ${updateId}`);
    throw new BadRequestError('You have already reacted with this type');
  }

  // Create a batch for atomic operations
  const batch = db.batch();
  const now = Timestamp.now();

  // Set or update the reaction document with arrayUnion
  batch.set(
    reactionRef,
    {
      [ReactionFields.TYPES]: FieldValue.arrayUnion(reactionType),
      [ReactionFields.UPDATED_AT]: now,
    },
    { merge: true },
  );

  // Get current reaction types to calculate new count
  const currentTypes = updateResult.data[UpdateFields.REACTION_TYPES] || {};
  const newPerTypeCount = (currentTypes[reactionType] || 0) + 1;

  // Prepare the update data for the update document
  const updateData: UpdateData<DocumentData> = {
    // Always increment total count when a reaction is added
    [UpdateFields.REACTION_COUNT]: FieldValue.increment(1),
    [`${UpdateFields.REACTION_TYPES}.${reactionType}`]: FieldValue.increment(1),
  };

  // Update the update document
  batch.update(updateResult.ref, updateData);

  // Commit the batch
  await batch.commit();
  logger.info(`Successfully created reaction type ${reactionType} for user ${currentUserId} on update ${updateId}`);

  // Return the reaction summary with the per-type count
  const response: ReactionGroup = {
    type: reactionType,
    count: newPerTypeCount,
  };

  // Create analytics event
  const newTotalReactionCount = (updateResult.data[UpdateFields.REACTION_COUNT] || 0) + 1;
  const event: ReactionEventParams = {
    reaction_count: newTotalReactionCount,
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
