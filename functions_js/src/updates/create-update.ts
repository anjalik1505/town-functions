import { Request, Response } from "express";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { v4 as uuidv4 } from "uuid";
import { Collections, UpdateFields } from "../models/constants";
import { Update } from "../models/data-models";
import { getLogger } from "../utils/logging_utils";

const logger = getLogger(__filename);

/**
 * Creates a new update for the current user.
 * 
 * This function creates a new update in the Firestore database with the content,
 * sentiment, and visibility settings (friend_ids and group_ids) provided in the request.
 * It also generates a combined visibility array for efficient querying.
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: The validated request data containing:
 *                - content: The text content of the update
 *                - sentiment: The sentiment value of the update
 *                - group_ids: Optional list of group IDs to share the update with
 *                - friend_ids: Optional list of friend IDs to share the update with
 * @param res - The Express response object
 * @returns A Promise that resolves to the created Update object
 */
export async function createUpdate(req: Request, res: Response): Promise<void> {
    logger.info(`Creating update for user: ${req.userId}`);

    // Get the authenticated user ID from the request
    const currentUserId = req.userId;

    // Get validated data from the request
    const validatedParams = req.validated_params;
    const content = validatedParams.content;
    const sentiment = validatedParams.sentiment;
    const groupIds = validatedParams.group_ids ?? [];
    const friendIds = validatedParams.friend_ids ?? [];

    logger.info(
        `Update details - content length: ${content.length}, ` +
        `sentiment: ${sentiment}, ` +
        `shared with ${friendIds.length} friends and ${groupIds.length} groups`
    );

    // Initialize Firestore client
    const db = getFirestore();

    // Generate a unique ID for the update
    const updateId = uuidv4();

    // Get current timestamp
    const createdAt = Timestamp.now();

    // Prepare the visible_to array for efficient querying
    // Format: ["friend:{friend_id}", "group:{group_id}"]
    const visibleTo: string[] = [];

    // Add friend visibility identifiers
    for (const friendId of friendIds) {
        visibleTo.push(`friend:${friendId}`);
    }

    // Add group visibility identifiers
    for (const groupId of groupIds) {
        visibleTo.push(`group:${groupId}`);
    }

    // Create the update document
    const updateData = {
        [UpdateFields.CREATED_BY]: currentUserId,
        [UpdateFields.CONTENT]: content,
        [UpdateFields.SENTIMENT]: sentiment,
        [UpdateFields.CREATED_AT]: createdAt,
        [UpdateFields.GROUP_IDS]: groupIds,
        [UpdateFields.FRIEND_IDS]: friendIds,
        [UpdateFields.VISIBLE_TO]: visibleTo,
    };

    // Save the update to Firestore
    await db.collection(Collections.UPDATES).doc(updateId).set(updateData);
    logger.info(`Successfully created update with ID: ${updateId}`);

    // Return the created update (without the internal visible_to field)
    const response: Update = {
        update_id: updateId,
        created_by: currentUserId,
        content: content,
        sentiment: sentiment,
        created_at: createdAt.toDate().toISOString(),
        group_ids: groupIds,
        friend_ids: friendIds,
    };

    res.json(response);
} 