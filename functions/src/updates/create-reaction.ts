import { Request, Response } from "express";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { v4 as uuidv4 } from "uuid";
import { Collections, ReactionFields, UpdateFields } from "../models/constants";
import { ReactionGroup } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { createFriendVisibilityIdentifier } from "../utils/visibility-utils";

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
 * @param res - The Express response object
 * 
 * @returns A ReactionGroup containing the reaction type and updated count
 * 
 * @throws 400: You have already reacted with this type
 * @throws 403: You don't have access to this update
 * @throws 404: Update not found
 */
export const createReaction = async (req: Request, res: Response): Promise<void> => {
    const currentUserId = req.userId;
    const updateId = req.params.update_id;
    const reactionType = req.validated_params.type;

    logger.info(`Creating ${reactionType} reaction on update ${updateId} by user ${currentUserId}`);

    const db = getFirestore();
    const updateRef = db.collection(Collections.UPDATES).doc(updateId);
    const updateDoc = await updateRef.get();

    if (!updateDoc.exists) {
        logger.warn(`Update ${updateId} not found`);
        res.status(404).json({
            code: 404,
            name: "Not Found",
            description: "Update not found"
        });
    }

    const updateData = updateDoc.data();
    const visibleTo = updateData?.[UpdateFields.VISIBLE_TO] || [];
    const friendVisibility = createFriendVisibilityIdentifier(currentUserId);

    if (!visibleTo.includes(friendVisibility)) {
        logger.warn(`User ${currentUserId} attempted to react to update ${updateId} without access`);
        res.status(403).json({
            code: 403,
            name: "Forbidden",
            description: "You don't have access to this update"
        });
    }

    // Check if user has already reacted with this type
    const existingReactionSnapshot = await updateRef.collection(Collections.REACTIONS)
        .where(ReactionFields.CREATED_BY, "==", currentUserId)
        .where(ReactionFields.TYPE, "==", reactionType)
        .get();

    if (!existingReactionSnapshot.empty) {
        logger.warn(`User ${currentUserId} attempted to create duplicate ${reactionType} reaction on update ${updateId}`);
        res.status(400).json({
            code: 400,
            name: "Bad Request",
            description: "You have already reacted with this type"
        });
    }

    // Create the reaction document
    const reactionId = uuidv4();
    const createdAt = Timestamp.now();

    const reactionData = {
        [ReactionFields.CREATED_BY]: currentUserId,
        [ReactionFields.TYPE]: reactionType,
        [ReactionFields.CREATED_AT]: createdAt
    };

    // Create a batch for atomic operations
    const batch = db.batch();

    // Add the reaction document
    batch.set(updateRef.collection(Collections.REACTIONS).doc(reactionId), reactionData);

    // Update the reaction count
    batch.update(updateRef, {
        reaction_count: (updateData?.reaction_count || 0) + 1
    });

    // Commit the batch
    await batch.commit();
    logger.info(`Successfully created reaction ${reactionId} on update ${updateId}`);

    // Return the reaction group with updated count
    const response: ReactionGroup = {
        type: reactionType,
        count: (updateData?.reaction_count || 0) + 1,
        reaction_id: reactionId
    };

    res.status(201).json(response);
} 