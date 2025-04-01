import { Request, Response } from "express";
import { getFirestore } from "firebase-admin/firestore";
import { Collections, ReactionFields, UpdateFields } from "../models/constants";
import { ReactionGroup } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { createFriendVisibilityIdentifier } from "../utils/visibility-utils";

const logger = getLogger(__filename);

/**
 * Deletes a reaction from an update.
 * 
 * This function:
 * 1. Verifies the user has access to the update
 * 2. Verifies the user created the reaction
 * 3. Deletes the reaction document
 * 4. Updates the reaction count on the update document
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Route parameters containing:
 *                - update_id: The ID of the update
 *                - reaction_id: The ID of the reaction to delete
 * @param res - The Express response object
 * 
 * @returns A ReactionGroup containing the reaction type and updated count
 * 
 * @throws 404: Update or reaction not found
 * @throws 403: You don't have access to this update or you can only delete your own reactions
 */
export const deleteReaction = async (req: Request, res: Response): Promise<void> => {
    const currentUserId = req.userId;
    const updateId = req.params.update_id;
    const reactionId = req.params.reaction_id;

    logger.info(`Deleting reaction ${reactionId} from update ${updateId} by user ${currentUserId}`);

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
        logger.warn(`User ${currentUserId} attempted to delete reaction on update ${updateId} without access`);
        res.status(403).json({
            code: 403,
            name: "Forbidden",
            description: "You don't have access to this update"
        });
    }

    // Get the reaction document
    const reactionRef = updateRef.collection(Collections.REACTIONS).doc(reactionId);
    const reactionDoc = await reactionRef.get();

    if (!reactionDoc.exists) {
        logger.warn(`Reaction ${reactionId} not found on update ${updateId}`);
        res.status(404).json({
            code: 404,
            name: "Not Found",
            description: "Reaction not found"
        });
    }

    const reactionData = reactionDoc.data();
    if (reactionData?.[ReactionFields.CREATED_BY] !== currentUserId) {
        logger.warn(`User ${currentUserId} attempted to delete reaction created by ${reactionData?.[ReactionFields.CREATED_BY]}`);
        res.status(403).json({
            code: 403,
            name: "Forbidden",
            description: "You can only delete your own reactions"
        });
    }

    // Create a batch for atomic operations
    const batch = db.batch();

    // Delete the reaction document
    batch.delete(reactionRef);

    // Update the reaction count
    batch.update(updateRef, {
        reaction_count: Math.max(0, (updateData?.reaction_count || 0) - 1)
    });

    // Commit the batch
    await batch.commit();
    logger.info(`Successfully deleted reaction ${reactionId} from update ${updateId}`);

    // Return the reaction group with updated count
    const response: ReactionGroup = {
        type: reactionData?.[ReactionFields.TYPE] || "",
        count: Math.max(0, (updateData?.reaction_count || 0) - 1),
        reaction_id: reactionId
    };

    res.status(200).json(response);
} 