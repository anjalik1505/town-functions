import { Request, Response } from "express";
import { getFirestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { Collections, GroupFields, QueryOperators, UpdateFields } from "../models/constants";
import { FeedResponse, Update } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";

const logger = getLogger(__filename);

/**
 * Retrieves all updates for a specific group, paginated.
 * 
 * This function fetches updates that include the specified group ID in their group_ids array.
 * The updates are returned in descending order by creation time (newest first) and
 * support pagination for efficient data loading.
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Pagination parameters containing:
 *                - limit: Maximum number of updates to return
 *                - after_timestamp: Timestamp for pagination
 * @param res - The Express response object
 * @param groupId - The ID of the group to retrieve updates for
 * 
 * Query Parameters:
 * - limit: Maximum number of updates to return (default: 20, min: 1, max: 100)
 * - after_timestamp: Timestamp for pagination in ISO format (e.g. "2025-01-01T12:00:00Z")
 * 
 * @returns A FeedResponse containing:
 * - A list of updates for the specified group
 * - A next_timestamp for pagination (if more results are available)
 * 
 * @throws 404: Group not found
 * @throws 403: User is not a member of the group
 * @throws 500: Internal server error
 */
export const getGroupFeed = async (req: Request, res: Response, groupId: string) => {
    logger.info(`Retrieving feed for group: ${groupId}`);

    // Get the authenticated user ID from the request
    const currentUserId = req.userId;

    // Initialize Firestore client
    const db = getFirestore();

    // Get pagination parameters from the validated request
    const validatedParams = req.validated_params;
    const limit = validatedParams?.limit || 20;
    const afterTimestamp = validatedParams?.after_timestamp;

    logger.info(
        `Pagination parameters - limit: ${limit}, after_timestamp: ${afterTimestamp}`
    );

    // First, check if the group exists and if the user is a member
    const groupRef = db.collection(Collections.GROUPS).doc(groupId);
    const groupDoc = await groupRef.get();

    if (!groupDoc.exists) {
        logger.warn(`Group ${groupId} not found`);
        return res.status(404).json({
            code: 404,
            name: "Not Found",
            description: "Group not found"
        });
    }

    const groupData = groupDoc.data() || {};
    const members = groupData[GroupFields.MEMBERS] || [];

    // Check if the current user is a member of the group
    if (!members.includes(currentUserId)) {
        logger.warn(`User ${currentUserId} is not a member of group ${groupId}`);
        return res.status(403).json({
            code: 403,
            name: "Forbidden",
            description: "You must be a member of the group to view its feed"
        });
    }

    // Build the query for updates from this group
    let query = db.collection(Collections.UPDATES)
        .where(UpdateFields.GROUP_IDS, QueryOperators.ARRAY_CONTAINS, groupId)
        .orderBy(UpdateFields.CREATED_AT, "desc");

    // Apply pagination if an after_timestamp is provided
    if (afterTimestamp) {
        query = query.startAfter({ [UpdateFields.CREATED_AT]: afterTimestamp });
        logger.info(`Applying pagination with timestamp: ${afterTimestamp}`);
    }

    // Apply limit last
    query = query.limit(limit);

    // Execute the query
    const updates: Update[] = [];
    let lastTimestamp: string | null = null;

    // Process the query results using streaming
    for await (const doc of query.stream()) {
        const updateDoc = doc as unknown as QueryDocumentSnapshot;
        const docData = updateDoc.data();
        const createdAt = docData[UpdateFields.CREATED_AT] || "";

        // Track the last timestamp for pagination
        if (createdAt) {
            lastTimestamp = createdAt;
        }

        // Convert Firestore document to Update model
        const update: Update = {
            update_id: updateDoc.id,
            created_by: docData[UpdateFields.CREATED_BY] || "",
            content: docData[UpdateFields.CONTENT] || "",
            group_ids: docData[UpdateFields.GROUP_IDS] || [],
            friend_ids: docData[UpdateFields.FRIEND_IDS] || [],
            sentiment: docData[UpdateFields.SENTIMENT] || 0,
            created_at: createdAt
        };
        updates.push(update);
    }

    logger.info("Query executed successfully");

    // Set up pagination for the next request
    let nextTimestamp: string | null = null;
    if (lastTimestamp && updates.length === limit) {
        nextTimestamp = lastTimestamp;
        logger.info(`More results available, next_timestamp: ${nextTimestamp}`);
    }

    logger.info(`Retrieved ${updates.length} updates for group: ${groupId}`);

    // Return the response
    const response: FeedResponse = {
        updates,
        next_timestamp: nextTimestamp
    };

    return res.json(response);
}; 