import { Request } from 'express';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { v4 as uuidv4 } from 'uuid';
import {
  ApiResponse,
  EventName,
  ReactionEventParams,
} from '../models/analytics-events';
import {
  Collections,
  QueryOperators,
  ReactionFields,
} from '../models/constants';
import { ReactionGroup } from '../models/data-models';
import { BadRequestError } from '../utils/errors';
import { getLogger } from '../utils/logging-utils';
import { getUpdateDoc, hasUpdateAccess } from '../utils/update-utils';

const logger = getLogger(__filename);

/**
 * Creates a new reaction on an update.
 *
 * This function:
 * 1. Verifies the user has access to the update
 * 2. Checks if the user has already reacted with this type
 * 3. Creates a new reaction in the reactions subcollection
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
export const createReaction = async (
  req: Request,
): Promise<ApiResponse<ReactionGroup>> => {
  const currentUserId = req.userId;
  const updateId = req.params.update_id;
  const reactionType = req.validated_params.type;

  logger.info(
    `Creating ${reactionType} reaction on update ${updateId} by user ${currentUserId}`,
  );

  const db = getFirestore();

  // Get the update document and verify access
  const updateResult = await getUpdateDoc(updateId);
  hasUpdateAccess(updateResult.data, currentUserId);

  // Check if user has already reacted with this type
  const existingReactionSnapshot = await updateResult.ref
    .collection(Collections.REACTIONS)
    .where(ReactionFields.CREATED_BY, QueryOperators.EQUALS, currentUserId)
    .where(ReactionFields.TYPE, QueryOperators.EQUALS, reactionType)
    .get();

  if (!existingReactionSnapshot.empty) {
    logger.warn(
      `User ${currentUserId} attempted to create duplicate ${reactionType} reaction on update ${updateId}`,
    );
    throw new BadRequestError('You have already reacted with this type');
  }

  // Create the reaction document
  const reactionId = uuidv4();
  const createdAt = Timestamp.now();

  const reactionData = {
    [ReactionFields.CREATED_BY]: currentUserId,
    [ReactionFields.TYPE]: reactionType,
    [ReactionFields.CREATED_AT]: createdAt,
  };

  // Create a batch for atomic operations
  const batch = db.batch();

  // Add the reaction document
  batch.set(
    updateResult.ref.collection(Collections.REACTIONS).doc(reactionId),
    reactionData,
  );

  // Update the reaction count
  batch.update(updateResult.ref, {
    reaction_count: (updateResult.data.reaction_count || 0) + 1,
  });

  // Commit the batch
  await batch.commit();
  logger.info(
    `Successfully created reaction ${reactionId} on update ${updateId}`,
  );

  // Return the reaction group with updated count
  const response: ReactionGroup = {
    type: reactionType,
    count: (updateResult.data.reaction_count || 0) + 1,
    reaction_id: reactionId,
  };

  // Create analytics event
  const event: ReactionEventParams = {
    reaction_count: (updateResult.data.reaction_count || 0) + 1,
    comment_count: updateResult.data.comment_count || 0,
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
