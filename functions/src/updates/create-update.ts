import { Request } from 'express';
import { DocumentData, getFirestore, Timestamp, UpdateData } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { ApiResponse, EventName, UpdateEventParams } from '../models/analytics-events.js';
import { Collections, FriendshipFields, GroupFields, QueryOperators, UpdateFields } from '../models/constants.js';
import { CreateUpdatePayload, Update } from '../models/data-models.js';
import { getLogger } from '../utils/logging-utils.js';
import { createFeedItem, formatUpdate } from '../utils/update-utils.js';
import {
  createFriendVisibilityIdentifier,
  createFriendVisibilityIdentifiers,
  createGroupVisibilityIdentifiers,
} from '../utils/visibility-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Creates a new update for the current user and creates feed items for all users who should see it.
 *
 * This function:
 * 1. Creates a new update in Firestore database
 * 2. Moves staging images to final location
 * 3. Creates feed items for all users who should see the update (friends and group members)
 * 4. Handles cases where a user might see the update through multiple channels
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
 *                - images: Optional list of staging image paths to move
 *
 * @returns A Promise that resolves to the created Update object
 */
export const createUpdate = async (req: Request): Promise<ApiResponse<Update>> => {
  logger.info(`Creating update for user: ${req.userId}`);

  // Get the authenticated user ID from the request
  const currentUserId = req.userId;

  // Get validated data from the request
  const validatedParams = req.validated_params as CreateUpdatePayload;
  const content = validatedParams.content || '';
  const sentiment = validatedParams.sentiment || '';
  const score = validatedParams.score || 3;
  const emoji = validatedParams.emoji || '😐';
  const allVillage = validatedParams.all_village || false;
  let groupIds = validatedParams.group_ids || [];
  let friendIds = validatedParams.friend_ids || [];
  const images = validatedParams.images || [];

  logger.info(
    `Update details - content length: ${content.length}, ` +
      `sentiment: ${sentiment}, score: ${score}, emoji: ${emoji}, ` +
      `all_village: ${allVillage}, ` +
      `shared with ${friendIds.length} friends and ${groupIds.length} groups, ` +
      `${images.length} images`,
  );

  // Initialize Firestore client
  const db = getFirestore();

  // If allVillage is true, get all friends and groups of the user
  if (allVillage) {
    logger.info(`All village mode enabled, fetching all friends and groups for user: ${currentUserId}`);

    // Get all accepted friendships
    const friendshipsQuery = db
      .collection(Collections.FRIENDSHIPS)
      .where(FriendshipFields.MEMBERS, QueryOperators.ARRAY_CONTAINS, currentUserId);

    const friendshipDocs = await friendshipsQuery.get();

    // Extract friend IDs from friendships
    friendshipDocs.forEach((doc) => {
      const friendshipData = doc.data();
      const isSender = friendshipData[FriendshipFields.SENDER_ID] === currentUserId;
      const friendId = isSender
        ? friendshipData[FriendshipFields.RECEIVER_ID]
        : friendshipData[FriendshipFields.SENDER_ID];
      friendIds.push(friendId);
    });

    // Deduplicate friendIds after extraction
    friendIds = Array.from(new Set(friendIds));

    // Get all groups where the user is a member
    const groupsQuery = db
      .collection(Collections.GROUPS)
      .where(GroupFields.MEMBERS, QueryOperators.ARRAY_CONTAINS, currentUserId);

    const groupDocs = await groupsQuery.get();

    // Extract group IDs
    groupDocs.forEach((doc) => {
      groupIds.push(doc.id);
    });

    // Deduplicate groupIds after extraction
    groupIds = Array.from(new Set(groupIds));

    logger.info(`All village mode: found ${friendIds.length} friends and ${groupIds.length} groups`);
  }

  // Get current timestamp
  const createdAt = Timestamp.now();

  // Prepare the visible_to array for efficient querying
  const visibleTo: string[] = [];

  // Add creator to a visible_to array
  visibleTo.push(createFriendVisibilityIdentifier(currentUserId));

  // Add friend visibility identifiers
  visibleTo.push(...createFriendVisibilityIdentifiers(friendIds));

  // Add group visibility identifiers
  visibleTo.push(...createGroupVisibilityIdentifiers(groupIds));

  // Run everything in a batch
  const batch = db.batch();

  // 1. Create the update document
  const updateRef = db.collection(Collections.UPDATES).doc();
  const updateId = updateRef.id;

  // Process images - move from staging to final location
  const finalImagePaths: string[] = [];
  const bucket = getStorage().bucket();

  if (images.length > 0) {
    logger.info(`Processing ${images.length} staging images`);

    for (const stagingPath of images) {
      try {
        const fileName = stagingPath.split('/').pop(); // extract 'fileName'
        if (!fileName) {
          logger.warn(`Invalid staging path: ${stagingPath}`);
          continue;
        }

        const srcFile = bucket.file(stagingPath);
        const destPath = `updates/${updateId}/${fileName}`;
        const destFile = bucket.file(destPath);

        // Set metadata for the destination file
        await srcFile.copy(destFile, {
          metadata: {
            created_by: currentUserId,
          },
        });

        await srcFile.delete(); // Delete original from staging
        finalImagePaths.push(destPath);

        logger.info(`Moved image from ${stagingPath} to ${destPath}`);
      } catch (error) {
        logger.error(`Failed to move image ${stagingPath}: ${error}`);
        // Continue with other images
      }
    }
  }

  // Create the update document
  const updateData: UpdateData<DocumentData> = {
    [UpdateFields.CREATED_BY]: currentUserId,
    [UpdateFields.CONTENT]: content,
    [UpdateFields.SENTIMENT]: sentiment,
    [UpdateFields.SCORE]: score,
    [UpdateFields.EMOJI]: emoji,
    [UpdateFields.CREATED_AT]: createdAt,
    [UpdateFields.GROUP_IDS]: groupIds,
    [UpdateFields.FRIEND_IDS]: friendIds,
    [UpdateFields.VISIBLE_TO]: visibleTo,
    [UpdateFields.ALL_VILLAGE]: allVillage,
    [UpdateFields.IMAGE_PATHS]: finalImagePaths,
    comment_count: 0,
    reaction_count: 0,
  };

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
      groupIds.map((groupId: string) => db.collection(Collections.GROUPS).doc(groupId).get()),
    );

    groupDocs.forEach((groupDoc) => {
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
    // Determine how this user can see the update
    const isDirectFriend = userId === currentUserId || friendIds.includes(userId);
    const userGroups = groupIds.filter((groupId: string) => groupMembersMap.get(groupId)?.has(userId));

    // Use the utility function to create the feed item
    createFeedItem(
      db,
      batch,
      userId,
      updateId,
      createdAt,
      isDirectFriend,
      isDirectFriend ? currentUserId : null,
      userGroups,
      currentUserId,
    );
  });

  // Commit the batch
  await batch.commit();

  logger.info(`Successfully created update with ID: ${updateId} and feed items for all users`);

  // Return the created update (without the internal visible_to field)
  const response = formatUpdate(updateId, updateData, currentUserId, []);

  const event: UpdateEventParams = {
    content_length: content.length,
    sentiment: sentiment,
    score: score,
    friend_count: friendIds.length,
    group_count: groupIds.length,
    all_village: allVillage,
    image_count: finalImagePaths.length,
  };
  return {
    data: response,
    status: 201,
    analytics: {
      event: EventName.UPDATE_CREATED,
      userId: currentUserId,
      params: event,
    },
  };
};
