import { getFirestore, QueryDocumentSnapshot, Timestamp, WriteBatch } from 'firebase-admin/firestore';
import { Collections, QueryOperators } from '../models/constants.js';
import { BaseGroup, BaseUser, Comment, EnrichedUpdate, ReactionGroup, Update } from '../models/data-models.js';
import {
  cf,
  commentConverter,
  CommentDoc,
  feedConverter,
  FeedDoc,
  groupConverter,
  updateConverter,
  UpdateDoc,
} from '../models/firestore/index.js';
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
 * @param sharedWithFriends Optional array of user profiles the update was shared with
 * @param sharedWithGroups Optional array of group profiles the update was shared with
 * @returns A formatted Update object
 */
export const formatUpdate = (
  updateId: string,
  updateData: UpdateDoc,
  createdBy: string,
  reactions: ReactionGroup[] = [],
  sharedWithFriends: BaseUser[] = [],
  sharedWithGroups: BaseGroup[] = [],
): Update => {
  return {
    update_id: updateId,
    created_by: createdBy,
    content: updateData.content || '',
    group_ids: updateData.group_ids || [],
    friend_ids: updateData.friend_ids || [],
    sentiment: updateData.sentiment || '',
    score: updateData.score || 3,
    emoji: updateData.emoji || '😊',
    created_at: formatTimestamp(updateData.created_at),
    comment_count: updateData.comment_count || 0,
    reaction_count: updateData.reaction_count || 0,
    reactions: reactions,
    all_village: updateData.all_village || false,
    images: updateData.image_paths || [],
    shared_with_friends: sharedWithFriends,
    shared_with_groups: sharedWithGroups,
  };
};

/**
 * Format an update document into an EnrichedUpdate object with user profile information
 * @param updateId The ID of the update
 * @param updateData The update document data
 * @param createdBy The ID of the user who created the update
 * @param reactions Optional reactions for the update
 * @param profile Optional profile data for the creator
 * @param sharedWithFriends Optional array of user profiles the update was shared with
 * @param sharedWithGroups Optional array of group profiles the update was shared with
 * @returns A formatted EnrichedUpdate object
 */
export const formatEnrichedUpdate = (
  updateId: string,
  updateData: UpdateDoc,
  createdBy: string,
  reactions: ReactionGroup[] = [],
  profile: { username: string; name: string; avatar: string } | null = null,
  sharedWithFriends: BaseUser[] = [],
  sharedWithGroups: BaseGroup[] = [],
): EnrichedUpdate => {
  const update = formatUpdate(updateId, updateData, createdBy, reactions, sharedWithFriends, sharedWithGroups);

  // Create a base object with the update properties
  return {
    ...update,
    username: profile?.username || '',
    name: profile?.name || '',
    avatar: profile?.avatar || '',
  };
};

/**
 * Process feed items and create update objects with shared_with data
 * @param feedDocs Array of feed document snapshots
 * @param updateMap Map of update IDs to update data
 * @param reactionsMap Map of update IDs to reactions
 * @param currentUserId The ID of the current user
 * @returns Array of formatted Update objects
 */
export const processFeedItems = async (
  feedDocs: QueryDocumentSnapshot<FeedDoc>[],
  updateMap: Map<string, UpdateDoc>,
  reactionsMap: Map<string, ReactionGroup[]>,
  currentUserId: string,
): Promise<Update[]> => {
  const updates = await Promise.all(
    feedDocs.map(async (feedItem) => {
      const feedData = feedItem.data();
      const updateId = feedData.update_id;
      const updateData = updateMap.get(updateId);

      if (!updateData) {
        logger.warn(`Missing update data for feed item ${feedItem.id}`);
        return null;
      }

      // Use denormalized data from the update document
      const sharedWithFriendsProfiles = updateData.shared_with_friends_profiles || [];
      const sharedWithGroupsProfiles = updateData.shared_with_groups_profiles || [];

      // Convert to BaseUser[] and BaseGroup[]
      const sharedWithFriends: BaseUser[] = sharedWithFriendsProfiles.map((profile) => ({
        user_id: profile.user_id,
        username: profile.username,
        name: profile.name,
        avatar: profile.avatar,
      }));

      const sharedWithGroups: BaseGroup[] = sharedWithGroupsProfiles.map((profile) => ({
        group_id: profile.group_id,
        name: profile.name,
        icon: profile.icon,
      }));

      return formatUpdate(
        updateId,
        updateData as UpdateDoc,
        currentUserId,
        reactionsMap.get(updateId) || [],
        sharedWithFriends,
        sharedWithGroups,
      );
    }),
  );

  return updates.filter((update): update is Update => update !== null);
};

/**
 * Process feed items and create enriched update objects with user profile information and shared_with data
 * @param feedDocs Array of feed document snapshots
 * @param updateMap Map of update IDs to update data
 * @returns Array of formatted EnrichedUpdate objects
 */
export const processEnrichedFeedItems = async (
  feedDocs: QueryDocumentSnapshot<FeedDoc>[],
  updateMap: Map<string, UpdateDoc>,
): Promise<EnrichedUpdate[]> => {
  const updates = await Promise.all(
    feedDocs.map(async (feedItem) => {
      const feedData = feedItem.data();
      const updateId = feedData.update_id;
      const updateData = updateMap.get(updateId);
      const createdBy = feedData.created_by;

      if (!updateData) {
        logger.warn(`Missing update data for feed item ${feedItem.id}`);
        return null;
      }

      // Use denormalized data from the update document
      const sharedWithFriendsProfiles = updateData.shared_with_friends_profiles || [];
      const sharedWithGroupsProfiles = updateData.shared_with_groups_profiles || [];

      // Convert to BaseUser[] and BaseGroup[]
      const sharedWithFriends: BaseUser[] = sharedWithFriendsProfiles.map((profile) => ({
        user_id: profile.user_id,
        username: profile.username,
        name: profile.name,
        avatar: profile.avatar,
      }));

      const sharedWithGroups: BaseGroup[] = sharedWithGroupsProfiles.map((profile) => ({
        group_id: profile.group_id,
        name: profile.name,
        icon: profile.icon,
      }));

      // Use denormalized creator profile or fall back to profiles map
      const creatorProfile = updateData.creator_profile || null;

      // Extract reactions from denormalized reaction_types field
      const reactionTypes = updateData.reaction_types || {};
      const reactions = Object.entries(reactionTypes)
        .map(([type, count]) => ({ type, count: count as number }))
        .filter((reaction) => reaction.count > 0);

      return formatEnrichedUpdate(
        updateId,
        updateData as UpdateDoc,
        createdBy,
        reactions,
        creatorProfile,
        sharedWithFriends,
        sharedWithGroups,
      );
    }),
  );

  return updates.filter((update): update is EnrichedUpdate => update !== null);
};

/**
 * Fetch updates by their IDs
 * @param updateIds Array of update IDs to fetch
 * @returns Map of update IDs to update data
 */
export const fetchUpdatesByIds = async (updateIds: string[]): Promise<Map<string, UpdateDoc>> => {
  const db = getFirestore();

  // Fetch all updates in parallel
  const updatePromises = updateIds.map((updateId) => db.collection(Collections.UPDATES).doc(updateId).get());
  const updateSnapshots = await Promise.all(updatePromises);

  // Create a map of update data for an easy lookup
  return new Map(updateSnapshots.filter((doc) => doc.exists).map((doc) => [doc.id, doc.data() as UpdateDoc]));
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
  ref: FirebaseFirestore.DocumentReference<UpdateDoc>;
  data: UpdateDoc;
}> => {
  const db = getFirestore();
  const updates = db.collection(Collections.UPDATES).withConverter(updateConverter);
  const updateRef = updates.doc(updateId);
  const updateDoc = await updateRef.get();

  const data = updateDoc.data();
  if (!data) {
    logger.warn(`Update not found: ${updateId}`);
    throw new NotFoundError('Update not found');
  }

  return {
    ref: updateRef,
    data,
  };
};

/**
 * Check if a user has access to an update
 * @param updateData The update document data
 * @param userId The ID of the user to check access for
 * @throws ForbiddenError if the user doesn't have access to the update
 */
export const hasUpdateAccess = async (updateData: UpdateDoc, userId: string): Promise<void> => {
  // Creator always has access
  const creatorId = updateData.created_by;
  if (creatorId === userId) {
    return;
  }

  // Check if the user is a friend with visibility
  const visibleTo = updateData.visible_to || [];
  const friendVisibility = createFriendVisibilityIdentifier(userId);

  if (visibleTo.includes(friendVisibility)) {
    return;
  }

  // If all_village is true, check if the user is a friend
  const isAllVillage = updateData.all_village || false;

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
  updateRef: FirebaseFirestore.DocumentReference<UpdateDoc>,
  limit: number,
  afterCursor?: string,
): Promise<{
  comments: Comment[];
  uniqueCreatorCount: number;
  nextCursor: string | null;
}> => {
  // Build the query
  let query = updateRef
    .collection(Collections.COMMENTS)
    .withConverter(commentConverter)
    .orderBy(cf('created_at'), QueryOperators.ASC);

  // Apply cursor-based pagination
  const paginatedQuery = await applyPagination(query, afterCursor, limit);

  // Process comments using streaming
  const { items: commentDocs, lastDoc } = await processQueryStream<QueryDocumentSnapshot<CommentDoc>>(
    paginatedQuery,
    (doc) => doc as QueryDocumentSnapshot<CommentDoc>,
    limit,
  );

  // Collect user IDs from comments
  const uniqueUserIds = new Set<string>();
  commentDocs.forEach((doc: QueryDocumentSnapshot<CommentDoc>) => {
    const commentData = doc.data();
    const createdBy = commentData.created_by || '';
    if (createdBy) {
      uniqueUserIds.add(createdBy);
    }
  });

  // Process comments and create enriched comment objects using denormalized data
  const enrichedComments = processEnrichedComments(commentDocs);

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
  const feedItemRef = db
    .collection(Collections.USER_FEEDS)
    .doc(userId)
    .collection(Collections.FEED)
    .withConverter(feedConverter)
    .doc(updateId);

  const feedItemData: FeedDoc = {
    update_id: updateId,
    created_at: createdAt,
    direct_visible: isDirectFriend,
    friend_id: friendId ?? undefined,
    group_ids: groupIds,
    created_by: createdBy,
  };

  batch.set(feedItemRef, feedItemData);
  logger.debug(`Added feed item for user ${userId} to batch`);
};

/**
 * Fetch profiles for friend IDs
 * @param friendIds Array of friend IDs
 * @returns Array of BaseUser profiles
 */
export const fetchFriendProfiles = async (friendIds: string[]): Promise<BaseUser[]> => {
  if (friendIds.length === 0) {
    return [];
  }

  // Fetch profiles for all friends
  const profiles = await fetchUsersProfiles(friendIds);

  // Convert to BaseUser array, filtering out any missing profiles
  return friendIds
    .map((userId) => {
      const profile = profiles.get(userId);
      if (profile) {
        return {
          user_id: userId,
          username: profile.username,
          name: profile.name,
          avatar: profile.avatar,
        };
      }
      return null;
    })
    .filter((profile): profile is BaseUser => profile !== null);
};

/**
 * Fetch basic group information for group IDs
 * @param groupIds Array of group IDs
 * @returns Array of BaseGroup information
 */
export const fetchGroupProfiles = async (groupIds: string[]): Promise<BaseGroup[]> => {
  if (groupIds.length === 0) {
    return [];
  }

  const db = getFirestore();
  const groups = db.collection(Collections.GROUPS).withConverter(groupConverter);
  const groupDocs = await Promise.all(groupIds.map((groupId: string) => groups.doc(groupId).get()));

  return groupDocs
    .map((groupDoc) => {
      const groupData = groupDoc.data();
      if (groupData) {
        return {
          group_id: groupDoc.id,
          name: groupData.name || '',
          icon: groupData.icon || '',
        };
      }
      return null;
    })
    .filter((group): group is BaseGroup => group !== null);
};
