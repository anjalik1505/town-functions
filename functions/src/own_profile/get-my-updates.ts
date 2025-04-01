import { Request, Response } from "express";
import { getFirestore, QueryDocumentSnapshot, Timestamp } from "firebase-admin/firestore";
import { Collections, QueryOperators, UpdateFields } from "../models/constants";
import { ReactionGroup, Update, UpdatesResponse } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { formatTimestamp } from "../utils/timestamp-utils";

const logger = getLogger(__filename);

/**
 * Retrieves the current user's updates in a paginated format.
 * 
 * This function:
 * 1. Fetches updates created by the authenticated user from Firestore
 * 2. Returns updates in descending order by creation time (newest first)
 * 3. Supports pagination for efficient data loading
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Pagination parameters containing:
 *                - limit: Maximum number of updates to return (default: 20, min: 1, max: 100)
 *                - after_timestamp: Timestamp for pagination in ISO format
 * @param res - The Express response object
 * 
 * @returns An UpdatesResponse containing:
 * - A list of updates belonging to the current user
 * - A next_timestamp for pagination (if more results are available)
 */
export const getUpdates = async (req: Request, res: Response): Promise<void> => {
    const currentUserId = req.userId;
    logger.info(`Retrieving updates for user: ${currentUserId}`);

    const db = getFirestore();

    // Get pagination parameters from the validated request
    const validatedParams = req.validated_params;
    const limit = validatedParams?.limit || 20;
    const afterTimestamp = validatedParams?.after_timestamp;

    logger.info(
        `Pagination parameters - limit: ${limit}, after_timestamp: ${afterTimestamp}`
    );

    // Build the query
    let query = db.collection(Collections.UPDATES)
        .where(UpdateFields.CREATED_BY, QueryOperators.EQUALS, currentUserId)
        .orderBy(UpdateFields.CREATED_AT, "desc");

    // Apply pagination if an after_timestamp is provided
    if (afterTimestamp) {
        query = query.startAfter({ [UpdateFields.CREATED_AT]: afterTimestamp });
        logger.info(`Applying pagination with timestamp: ${afterTimestamp}`);
    }

    // Apply limit last
    query = query.limit(limit);

    // Execute the query
    const docs = query.stream();
    logger.info("Query executed successfully");

    const updates: Update[] = [];
    let lastTimestamp: Timestamp | null = null;

    // Process the query results
    for await (const doc of docs) {
        const updateDoc = doc as unknown as QueryDocumentSnapshot;
        const docData = updateDoc.data();
        const createdAt = docData[UpdateFields.CREATED_AT] as Timestamp;

        // Track the last timestamp for pagination
        if (createdAt) {
            lastTimestamp = createdAt;
        }

        // Convert Firestore datetime to ISO format string
        const createdAtIso = createdAt ? formatTimestamp(createdAt) : "";

        // Fetch reactions for this update
        let reactions: ReactionGroup[] = [];
        try {
            const reactionsSnapshot = await db.collection(Collections.UPDATES)
                .doc(updateDoc.id)
                .collection(Collections.REACTIONS)
                .get();

            const reactionsByType = new Map<string, { count: number; id: string }>();

            reactionsSnapshot.docs.forEach(doc => {
                const reactionData = doc.data();
                const type = reactionData.type;
                const current = reactionsByType.get(type) || { count: 0, id: doc.id };
                reactionsByType.set(type, { count: current.count + 1, id: doc.id });
            });

            reactionsByType.forEach((data, type) => {
                reactions.push({ type, count: data.count, reaction_id: data.id });
            });
        } catch (error) {
            logger.error(`Error fetching reactions for update ${updateDoc.id}: ${error}`);
        }

        // Convert Firestore document to Update model
        const update: Update = {
            update_id: updateDoc.id,
            created_by: docData[UpdateFields.CREATED_BY] || currentUserId,
            content: docData[UpdateFields.CONTENT] || "",
            group_ids: docData[UpdateFields.GROUP_IDS] || [],
            friend_ids: docData[UpdateFields.FRIEND_IDS] || [],
            sentiment: docData[UpdateFields.SENTIMENT] || "",
            created_at: createdAtIso,
            comment_count: docData.comment_count || 0,
            reaction_count: docData.reaction_count || 0,
            reactions
        };

        updates.push(update);
    }

    // Set up pagination for the next request
    let nextTimestamp: string | null = null;
    if (lastTimestamp && updates.length === limit) {
        // Convert the timestamp to ISO format for pagination
        nextTimestamp = formatTimestamp(lastTimestamp);
        logger.info(`More results available, next_timestamp: ${nextTimestamp}`);
    }

    logger.info(`Retrieved ${updates.length} updates for user: ${currentUserId}`);
    const response: UpdatesResponse = { updates, next_timestamp: nextTimestamp };
    res.json(response);
}; 