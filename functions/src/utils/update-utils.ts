import { getFirestore, QueryDocumentSnapshot, Timestamp, WriteBatch } from 'firebase-admin/firestore';
import { Collections, CommentFields, FeedFields, QueryOperators, UpdateFields } from '../models/constants.js';
import { Comment, EnrichedUpdate, ReactionGroup, Update } from '../models/data-models.js';
import { processEnrichedComments } from './comment-utils.js';
import { ForbiddenError, NotFoundError } from './errors.js';
import { areFriends } from './friendship-utils.js';
import { getLogger } from './logging-utils.js';
import { applyPagination, generateNextCursor, processQueryStream } from './pagination-utils.js';
import { fetchUsersProfiles } from './profile-utils.js';
import { formatTimestamp } from './timestamp-utils.js';
import { createFriendVisibilityIdentifier } from './visibility-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Format an update document into a standard Update object
 * @param updateId The ID of the update
 * @param updateData The update document data
 * @param createdBy The ID of the user who created the update
 * @param reactions Optional reactions for the update
 * @returns A formatted Update object
 */
export const formatUpdate = (
  updateId: string,
  updateData: FirebaseFirestore.DocumentData,
  createdBy: string,
  reactions: ReactionGroup[] = [],
): Update => {
  return {
    update_id: updateId,
    created_by: createdBy,
    content: updateData[UpdateFields.CONTENT] || '',
    group_ids: updateData[UpdateFields.GROUP_IDS] || [],
    friend_ids: updateData[UpdateFields.FRIEND_IDS] || [],
    sentiment: updateData[UpdateFields.SENTIMENT] || '',
    score: updateData[UpdateFields.SCORE] || 3,
    emoji: updateData[UpdateFields.EMOJI] || '😊',
    created_at: formatTimestamp(updateData[UpdateFields.CREATED_AT]),
    comment_count: updateData.comment_count || 0,
    reaction_count: updateData.reaction_count || 0,
    reactions: reactions,
    all_village: updateData[UpdateFields.ALL_VILLAGE] || false,
    images: updateData[UpdateFields.IMAGE_PATHS] || [],
  };
};

/**
 * Format an update document into an EnrichedUpdate object with user profile information
 * @param updateId The ID of the update
 * @param updateData The update document data
 * @param createdBy The ID of the user who created the update
 * @param reactions Optional reactions for the update
 * @param profile Optional profile data for the creator
 * @returns A formatted EnrichedUpdate object
 */
export const formatEnrichedUpdate = (
  updateId: string,
  updateData: FirebaseFirestore.DocumentData,
  createdBy: string,
  reactions: ReactionGroup[] = [],
  profile: { username: string; name: string; avatar: string } | null = null,
): EnrichedUpdate => {
  const update = formatUpdate(updateId, updateData, createdBy, reactions);

  // Create a base object with the update properties
  return {
    ...update,
    username: profile?.username || '',
    name: profile?.name || '',
    avatar: profile?.avatar || '',
  };
};

/**
 * Process feed items and create update objects
 * @param feedDocs Array of feed document snapshots
 * @param updateMap Map of update IDs to update data
 * @param reactionsMap Map of update IDs to reactions
 * @param currentUserId The ID of the current user
 * @returns Array of formatted Update objects
 */
export const processFeedItems = (
  feedDocs: QueryDocumentSnapshot[],
  updateMap: Map<string, FirebaseFirestore.DocumentData>,
  reactionsMap: Map<string, ReactionGroup[]>,
  currentUserId: string,
): Update[] => {
  return feedDocs
    .map((feedItem) => {
      const feedData = feedItem.data();
      const updateId = feedData[FeedFields.UPDATE_ID];
      const updateData = updateMap.get(updateId);

      if (!updateData) {
        logger.warn(`Missing update data for feed item ${feedItem.id}`);
        return null;
      }

      return formatUpdate(updateId, updateData, currentUserId, reactionsMap.get(updateId) || []);
    })
    .filter((update): update is Update => update !== null);
};

/**
 * Process feed items and create enriched update objects with user profile information
 * @param feedDocs Array of feed document snapshots
 * @param updateMap Map of update IDs to update data
 * @param reactionsMap Map of update IDs to reactions
 * @param profiles Map of user IDs to profile data
 * @returns Array of formatted EnrichedUpdate objects
 */
export const processEnrichedFeedItems = (
  feedDocs: QueryDocumentSnapshot[],
  updateMap: Map<string, FirebaseFirestore.DocumentData>,
  reactionsMap: Map<string, ReactionGroup[]>,
  profiles: Map<string, { username: string; name: string; avatar: string }>,
): EnrichedUpdate[] => {
  return feedDocs
    .map((feedItem) => {
      const feedData = feedItem.data();
      const updateId = feedData[FeedFields.UPDATE_ID];
      const updateData = updateMap.get(updateId);
      const createdBy = feedData[FeedFields.CREATED_BY];

      if (!updateData) {
        logger.warn(`Missing update data for feed item ${feedItem.id}`);
        return null;
      }

      return formatEnrichedUpdate(
        updateId,
        updateData,
        createdBy,
        reactionsMap.get(updateId) || [],
        profiles.get(createdBy) || null,
      );
    })
    .filter((update): update is EnrichedUpdate => update !== null);
};

/**
 * Fetch updates by their IDs
 * @param updateIds Array of update IDs to fetch
 * @returns Map of update IDs to update data
 */
export const fetchUpdatesByIds = async (updateIds: string[]): Promise<Map<string, FirebaseFirestore.DocumentData>> => {
  const db = getFirestore();

  // Fetch all updates in parallel
  const updatePromises = updateIds.map((updateId) => db.collection(Collections.UPDATES).doc(updateId).get());
  const updateSnapshots = await Promise.all(updatePromises);

  // Create a map of update data for an easy lookup
  return new Map(
    updateSnapshots.filter((doc) => doc.exists).map((doc) => [doc.id, doc.data() as FirebaseFirestore.DocumentData]),
  );
};

/**
 * Get an update document by ID
 * @param updateId The ID of the update
 * @returns The update document and data, or null if not found
 * @throws NotFoundError if the update doesn't exist
 */
export const getUpdateDoc = async (
  updateId: string,
): Promise<{
  ref: FirebaseFirestore.DocumentReference;
  data: FirebaseFirestore.DocumentData;
}> => {
  const db = getFirestore();
  const updateRef = db.collection(Collections.UPDATES).doc(updateId);
  const updateDoc = await updateRef.get();

  if (!updateDoc.exists) {
    logger.warn(`Update not found: ${updateId}`);
    throw new NotFoundError('Update not found');
  }

  return {
    ref: updateRef,
    data: updateDoc.data() || {},
  };
};

/**
 * Check if a user has access to an update
 * @param updateData The update document data
 * @param userId The ID of the user to check access for
 * @throws ForbiddenError if the user doesn't have access to the update
 */
export const hasUpdateAccess = async (updateData: FirebaseFirestore.DocumentData, userId: string): Promise<void> => {
  // Creator always has access
  const creatorId = updateData[UpdateFields.CREATED_BY];
  if (creatorId === userId) {
    return;
  }

  // Check if the user is a friend with visibility
  const visibleTo = updateData[UpdateFields.VISIBLE_TO] || [];
  const friendVisibility = createFriendVisibilityIdentifier(userId);

  if (visibleTo.includes(friendVisibility)) {
    return;
  }

  // If all_village is true, check if the user is a friend
  const isAllVillage = updateData[UpdateFields.ALL_VILLAGE] || false;

  if (isAllVillage) {
    // Check if the users are friends
    const areFriendsResult = await areFriends(creatorId, userId);

    if (areFriendsResult) {
      return;
    }
  }

  throw new ForbiddenError("You don't have access to this update");
};

/**
 * Fetch and process paginated comments for an update
 * @param updateRef The update document reference
 * @param limit Maximum number of comments to fetch
 * @param afterCursor Cursor for pagination
 * @returns Object containing enriched comments and next cursor
 */
export const fetchUpdateComments = async (
  updateRef: FirebaseFirestore.DocumentReference,
  limit: number,
  afterCursor?: string,
): Promise<{
  comments: Comment[];
  uniqueCreatorCount: number;
  nextCursor: string | null;
}> => {
  // Build the query
  let query = updateRef.collection(Collections.COMMENTS).orderBy(CommentFields.CREATED_AT, QueryOperators.ASC);

  // Apply cursor-based pagination
  const paginatedQuery = await applyPagination(query, afterCursor, limit);

  // Process comments using streaming
  const { items: commentDocs, lastDoc } = await processQueryStream<QueryDocumentSnapshot>(
    paginatedQuery,
    (doc: QueryDocumentSnapshot) => doc,
    limit,
  );

  // Collect user IDs from comments
  const uniqueUserIds = new Set<string>();
  commentDocs.forEach((doc: QueryDocumentSnapshot) => {
    const createdBy = doc.data()[CommentFields.CREATED_BY] || '';
    if (createdBy) {
      uniqueUserIds.add(createdBy);
    }
  });

  // Get profiles for all users who commented
  const profiles = await fetchUsersProfiles(Array.from(uniqueUserIds));

  // Process comments and create enriched comment objects
  const enrichedComments = processEnrichedComments(commentDocs, profiles);

  // Set up pagination for the next request
  const nextCursor = generateNextCursor(lastDoc, enrichedComments.length, limit);

  return {
    comments: enrichedComments.slice(0, limit),
    uniqueCreatorCount: uniqueUserIds.size,
    nextCursor,
  };
};

/**
 * Create a feed item for a user
 *
 * @param db - Firestore client
 * @param batch - Firestore write batch
 * @param userId - The ID of the user who will see the feed item
 * @param updateId - The ID of the update
 * @param createdAt - The timestamp when the update was created
 * @param isDirectFriend - Whether the user is directly connected to the creator
 * @param friendId - The ID of the friend who created the update (or null if not a direct friend)
 * @param groupIds - Array of group IDs through which the user can see the update
 * @param createdBy - The ID of the user who created the update
 */
export const createFeedItem = (
  db: FirebaseFirestore.Firestore,
  batch: WriteBatch,
  userId: string,
  updateId: string,
  createdAt: Timestamp,
  isDirectFriend: boolean,
  friendId: string | null,
  groupIds: string[],
  createdBy: string,
): void => {
  const feedItemRef = db.collection(Collections.USER_FEEDS).doc(userId).collection(Collections.FEED).doc(updateId);

  const feedItemData = {
    [FeedFields.UPDATE_ID]: updateId,
    [FeedFields.CREATED_AT]: createdAt,
    [FeedFields.DIRECT_VISIBLE]: isDirectFriend,
    [FeedFields.FRIEND_ID]: friendId,
    [FeedFields.GROUP_IDS]: groupIds,
    [FeedFields.CREATED_BY]: createdBy,
  };

  batch.set(feedItemRef, feedItemData);
  logger.debug(`Added feed item for user ${userId} to batch`);
};
