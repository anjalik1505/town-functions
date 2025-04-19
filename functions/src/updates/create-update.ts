import { Request, Response } from "express";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { v4 as uuidv4 } from "uuid";
import { Collections, FeedFields, UpdateFields } from "../models/constants";
import { Update } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { formatTimestamp } from "../utils/timestamp-utils";
import {
    createFriendVisibilityIdentifier,
    createFriendVisibilityIdentifiers,
    createGroupVisibilityIdentifiers
} from "../utils/visibility-utils";

const logger = getLogger(__filename);

/**
 * Creates a new update for the current user and creates feed items for all users who should see it.
 * 
 * This function:
 * 1. Creates a new update in the Firestore database
 * 2. Creates feed items for all users who should see the update (friends and group members)
 * 3. Handles cases where a user might see the update through multiple channels
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: The validated request data containing:
 *                - content: The text content of the update
 *                - sentiment: The sentiment value of the update
 *                - score: The score of the update
 *                - emoji: The emoji of the update
 *                - group_ids: Optional list of group IDs to share the update with
 *                - friend_ids: Optional list of friend IDs to share the update with
 * @param res - The Express response object
 * @returns A Promise that resolves to the created Update object
 */
export const createUpdate = async (req: Request, res: Response): Promise<void> => {
    logger.info(`Creating update for user: ${req.userId}`);

    // Get the authenticated user ID from the request
    const currentUserId = req.userId;

    // Get validated data from the request
    const validatedParams = req.validated_params;
    const content = validatedParams.content || "";
    const sentiment = validatedParams.sentiment || "";
    const score = validatedParams.score || "3";
    const emoji = validatedParams.emoji || "😐";
    const groupIds = validatedParams.group_ids || [];
    const friendIds = validatedParams.friend_ids || [];

    logger.info(
        `Update details - content length: ${content.length}, ` +
        `sentiment: ${sentiment}, score: ${score}, emoji: ${emoji}, ` +
        `shared with ${friendIds.length} friends and ${groupIds.length} groups`
    );

    // Initialize Firestore client
    const db = getFirestore();

    // Generate a unique ID for the update
    const updateId = uuidv4();

    // Get current timestamp
    const createdAt = Timestamp.now();

    // Prepare the visible_to array for efficient querying
    const visibleTo: string[] = [];

    // Add creator to visible_to array
    visibleTo.push(createFriendVisibilityIdentifier(currentUserId));

    // Add friend visibility identifiers
    visibleTo.push(...createFriendVisibilityIdentifiers(friendIds));

    // Add group visibility identifiers
    visibleTo.push(...createGroupVisibilityIdentifiers(groupIds));

    // Create the update document
    const updateData = {
        [UpdateFields.CREATED_BY]: currentUserId,
        [UpdateFields.CONTENT]: content,
        [UpdateFields.SENTIMENT]: sentiment,
        [UpdateFields.SCORE]: score,
        [UpdateFields.EMOJI]: emoji,
        [UpdateFields.CREATED_AT]: createdAt,
        [UpdateFields.GROUP_IDS]: groupIds,
        [UpdateFields.FRIEND_IDS]: friendIds,
        [UpdateFields.VISIBLE_TO]: visibleTo,
        comment_count: 0,
        reaction_count: 0
    };

    // Run everything in a batch
    const batch = db.batch();

    // 1. Create the update document
    const updateRef = db.collection(Collections.UPDATES).doc(updateId);
    batch.set(updateRef, updateData);

    // 2. Get all users who should see this update
    const usersToNotify = new Set<string>();

    // Add creator to the set
    usersToNotify.add(currentUserId);

    // Add all friends
    friendIds.forEach((friendId: string) => usersToNotify.add(friendId));

    // Create a map of group members for efficient lookup
    const groupMembersMap = new Map<string, Set<string>>();

    // Get all group members if there are groups
    if (groupIds.length > 0) {
        const groupDocs = await Promise.all(
            groupIds.map((groupId: string) =>
                db.collection(Collections.GROUPS).doc(groupId).get()
            )
        );

        groupDocs.forEach(groupDoc => {
            if (groupDoc.exists) {
                const groupData = groupDoc.data();
                if (groupData && groupData.members) {
                    groupMembersMap.set(groupDoc.id, new Set(groupData.members));
                    groupData.members.forEach((memberId: string) => usersToNotify.add(memberId));
                }
            }
        });
    }

    // 3. Create feed items for each user
    Array.from(usersToNotify).forEach((userId) => {
        const feedItemRef = db
            .collection(Collections.USER_FEEDS)
            .doc(userId)
            .collection(Collections.FEED)
            .doc(updateId);

        // Determine how this user can see the update
        const isDirectFriend = userId === currentUserId || friendIds.includes(userId);
        const userGroups = groupIds.filter((groupId: string) =>
            groupMembersMap.get(groupId)?.has(userId)
        );

        const feedItemData = {
            [FeedFields.UPDATE_ID]: updateId,
            [FeedFields.CREATED_AT]: createdAt,
            [FeedFields.DIRECT_VISIBLE]: isDirectFriend,
            [FeedFields.FRIEND_ID]: isDirectFriend ? currentUserId : null,
            [FeedFields.GROUP_IDS]: userGroups,
            [FeedFields.CREATED_BY]: currentUserId
        };

        batch.set(feedItemRef, feedItemData);
    });

    // Commit the batch
    await batch.commit();

    logger.info(`Successfully created update with ID: ${updateId} and feed items for all users`);

    // Return the created update (without the internal visible_to field)
    const response: Update = {
        update_id: updateId,
        created_by: currentUserId,
        content: content,
        sentiment: sentiment,
        score: score,
        emoji: emoji,
        created_at: formatTimestamp(createdAt),
        group_ids: groupIds,
        friend_ids: friendIds,
        comment_count: 0,
        reaction_count: 0,
        reactions: []
    };

    res.json(response);
} 