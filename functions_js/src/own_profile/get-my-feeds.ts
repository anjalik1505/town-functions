import { Request, Response } from "express";
import { getFirestore, QueryDocumentSnapshot, Timestamp, WhereFilterOp } from "firebase-admin/firestore";
import { Collections, ProfileFields, QueryOperators, UpdateFields } from "../models/constants";
import { Update } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { formatTimestamp } from "../utils/timestamp-utils";
import {
    createFriendVisibilityIdentifier,
    createGroupVisibilityIdentifiers
} from "../utils/visibility-utils";

const logger = getLogger(__filename);

/**
 * Aggregates feed of all updates from the user's friends and all groups the current user is in, paginated.
 * 
 * This function retrieves:
 * 1. Updates from all friends of the authenticated user
 * 2. Updates from all groups that the authenticated user is a member of
 * 
 * The updates are returned in descending order by creation time (newest first) and
 * support pagination for efficient data loading.
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Pagination parameters containing:
 *                - limit: Maximum number of updates to return (default: 20, min: 1, max: 100)
 *                - after_timestamp: Timestamp for pagination in ISO format
 * @param res - The Express response object
 * 
 * @returns A FeedResponse containing:
 * - A list of updates from all friends and all groups the user is in
 * - A next_timestamp for pagination (if more results are available)
 */
export const getFeeds = async (req: Request, res: Response) => {
    const currentUserId = req.userId;
    logger.info(`Retrieving feed for user: ${currentUserId}`);

    const db = getFirestore();

    // Get pagination parameters from the validated request
    const validatedParams = req.validated_params;
    const limit = validatedParams?.limit || 20;
    const afterTimestamp = validatedParams?.after_timestamp;

    logger.info(
        `Pagination parameters - limit: ${limit}, after_timestamp: ${afterTimestamp}`
    );

    // Get the user's profile
    const userRef = db.collection(Collections.PROFILES).doc(currentUserId);
    const userDoc = await userRef.get();

    // Return empty response if user profile doesn't exist
    if (!userDoc.exists) {
        logger.warn(`User profile not found for user: ${currentUserId}`);
        return res.json({ updates: [], next_timestamp: null });
    }

    // Extract group IDs from the user's profile
    const userData = userDoc.data() || {};
    const groupIds = userData[ProfileFields.GROUP_IDS] || [];

    // Prepare visibility identifiers
    // Direct visibility as a friend
    const friendVisibility = createFriendVisibilityIdentifier(currentUserId);

    // Group visibility for all groups the user is in
    const groupVisibilities = createGroupVisibilityIdentifiers(groupIds);

    // Combine all visibility identifiers
    const allVisibilities = [friendVisibility, ...groupVisibilities];

    logger.info(
        `User ${currentUserId} has visibility to ${allVisibilities.length} audiences (1 friend + ${groupIds.length} groups)`
    );

    // Return empty response if user has no visibility (should not happen with friend visibility)
    if (!allVisibilities.length) {
        logger.info(`User ${currentUserId} has no visibility to any updates`);
        return res.json({ updates: [], next_timestamp: null });
    }

    // Initialize results tracking
    const processedUpdateIds = new Set<string>(); // Track processed update IDs to avoid duplicates
    const allBatchUpdates: Update[] = []; // Collect all updates from all batches

    // Firestore has a limit of 10 values for array-contains-any
    // Split visibility identifiers into batches of 10 if needed
    const MAX_ARRAY_CONTAINS = 10;
    const visibilityBatches = [];
    for (let i = 0; i < allVisibilities.length; i += MAX_ARRAY_CONTAINS) {
        visibilityBatches.push(allVisibilities.slice(i, i + MAX_ARRAY_CONTAINS));
    }

    logger.info(
        `Split ${allVisibilities.length} visibility identifiers into ${visibilityBatches.length} batches for querying`
    );

    // Process all visibility batches to get updates
    for (const visibilityBatch of visibilityBatches) {
        // Query for updates visible to any identifier in this batch
        let visibilityQuery = db.collection(Collections.UPDATES)
            .where(UpdateFields.VISIBLE_TO, QueryOperators.ARRAY_CONTAINS_ANY as WhereFilterOp, visibilityBatch)
            .orderBy(UpdateFields.CREATED_AT, "desc");

        // Apply pagination
        if (afterTimestamp) {
            visibilityQuery = visibilityQuery.startAfter({ [UpdateFields.CREATED_AT]: afterTimestamp });
        }

        // Process updates as they stream in
        for await (const doc of visibilityQuery.limit(limit).stream()) {
            const updateDoc = doc as unknown as QueryDocumentSnapshot;

            // Skip if we've already processed this update
            if (processedUpdateIds.has(updateDoc.id)) {
                continue;
            }

            processedUpdateIds.add(updateDoc.id);
            const docData = updateDoc.data();
            const createdAt = docData[UpdateFields.CREATED_AT] as Timestamp;
            const createdBy = docData[UpdateFields.CREATED_BY] || "";

            // Convert Firestore datetime to ISO format string
            const createdAtIso = createdAt ? formatTimestamp(createdAt) : "";

            // Convert Firestore document to Update model
            const update: Update = {
                update_id: updateDoc.id,
                created_by: createdBy,
                content: docData[UpdateFields.CONTENT] || "",
                group_ids: docData[UpdateFields.GROUP_IDS] || [],
                friend_ids: docData[UpdateFields.FRIEND_IDS] || [],
                sentiment: docData[UpdateFields.SENTIMENT] || "",
                created_at: createdAtIso
            };

            allBatchUpdates.push(update);
        }
    }

    // If we have updates, sort them by created_at
    if (allBatchUpdates.length) {
        // Sort all updates by created_at (newest first)
        allBatchUpdates.sort((a, b) => b.created_at.localeCompare(a.created_at));

        // Take only up to the limit
        const sortedUpdates = allBatchUpdates.slice(0, limit);

        // Set up pagination for the next request
        let nextTimestamp: string | null = null;
        if (allBatchUpdates.length > limit) {
            const lastUpdate = sortedUpdates[sortedUpdates.length - 1];
            nextTimestamp = lastUpdate.created_at;
            logger.info(`More results available, next_timestamp: ${nextTimestamp}`);
        }

        logger.info(`Retrieved ${sortedUpdates.length} updates for user ${currentUserId}`);
        return res.json({ updates: sortedUpdates, next_timestamp: nextTimestamp });
    } else {
        // No updates found
        logger.info(`No updates found for user ${currentUserId}`);
        return res.json({ updates: [], next_timestamp: null });
    }
}; 