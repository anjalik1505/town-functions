import {Request, Response} from "express";
import {getFirestore, QueryDocumentSnapshot} from "firebase-admin/firestore";
import {Collections, GroupFields, ProfileFields, QueryOperators, UpdateFields} from "../models/constants";
import {EnrichedUpdate, FeedResponse, GroupMember, Update} from "../models/data-models";
import {ForbiddenError, NotFoundError} from "../utils/errors";
import {getLogger} from "../utils/logging-utils";
import {applyPagination, generateNextCursor, processQueryStream} from "../utils/pagination-utils";
import {formatTimestamp} from "../utils/timestamp-utils";

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
 *                - after_cursor: Cursor for pagination (base64 encoded document path)
 * @param res - The Express response object
 * @param groupId - The ID of the group to retrieve updates for
 *
 * Query Parameters:
 * - limit: Maximum number of updates to return (default: 20, min: 1, max: 100)
 * - after_cursor: Cursor for pagination (base64 encoded document path)
 *
 * @returns A FeedResponse containing:
 * - A list of updates for the specified group
 * - A next_cursor for pagination (if more results are available)
 *
 * @throws 404: Group not found
 * @throws 403: User is not a member of the group
 * @throws 500: Internal server error
 */
export const getGroupFeed = async (req: Request, res: Response, groupId: string): Promise<void> => {
  logger.info(`Retrieving feed for group: ${groupId}`);

  // Get the authenticated user ID from the request
  const currentUserId = req.userId;

  // Initialize Firestore client
  const db = getFirestore();

  // Get pagination parameters from the validated request
  const validatedParams = req.validated_params;
  const limit = validatedParams?.limit || 20;
  const afterCursor = validatedParams?.after_cursor;

  logger.info(
    `Pagination parameters - limit: ${limit}, after_cursor: ${afterCursor}`
  );

  // First, check if the group exists and if the user is a member
  const groupRef = db.collection(Collections.GROUPS).doc(groupId);
  const groupDoc = await groupRef.get();

  if (!groupDoc.exists) {
    logger.warn(`Group ${groupId} not found`);
    throw new NotFoundError("Group not found");
  }

  const groupData = groupDoc.data() || {};
  const members = groupData[GroupFields.MEMBERS] || [];

  // Check if the current user is a member of the group
  if (!members.includes(currentUserId)) {
    logger.warn(`User ${currentUserId} is not a member of group ${groupId}`);
    throw new ForbiddenError("You must be a member of the group to view its feed");
  }

  // Build the query for updates from this group
  let query = db.collection(Collections.UPDATES)
    .where(UpdateFields.GROUP_IDS, QueryOperators.ARRAY_CONTAINS, groupId)
    .orderBy(UpdateFields.CREATED_AT, QueryOperators.DESC);

  // Apply cursor-based pagination - errors will be automatically caught by Express
  const paginatedQuery = await applyPagination(query, afterCursor, limit);

  // Process updates using streaming
  const {
    items: updateDocs,
    lastDoc
  } = await processQueryStream<QueryDocumentSnapshot>(paginatedQuery, doc => doc, limit);

  // Convert Firestore documents to Update models
  const updates: Update[] = updateDocs.map(updateDoc => {
    const docData = updateDoc.data();
    const update: Update = {
      update_id: updateDoc.id,
      created_by: docData[UpdateFields.CREATED_BY] || "",
      content: docData[UpdateFields.CONTENT] || "",
      group_ids: docData[UpdateFields.GROUP_IDS] || [],
      friend_ids: docData[UpdateFields.FRIEND_IDS] || [],
      sentiment: docData[UpdateFields.SENTIMENT] || "",
      created_at: docData[UpdateFields.CREATED_AT] ? formatTimestamp(docData[UpdateFields.CREATED_AT]) : "",
      comment_count: docData[UpdateFields.COMMENT_COUNT] || 0,
      reaction_count: docData[UpdateFields.REACTION_COUNT] || 0,
      reactions: [], // Empty array since reactions are fetched separately
      score: docData[UpdateFields.SCORE] || "3",
      emoji: docData[UpdateFields.EMOJI] || "😐"
    };
    return update;
  });

  logger.info("Query executed successfully");

  // Get member profiles from the group document
  const memberProfiles = groupData[GroupFields.MEMBER_PROFILES] || [];
  const memberProfilesMap = new Map<string, GroupMember>();

  // Build the map of user IDs to their profile data
  for (const profile of memberProfiles) {
    const member: GroupMember = {
      user_id: profile[ProfileFields.USER_ID] || "",
      username: profile[ProfileFields.USERNAME] || "",
      name: profile[ProfileFields.NAME] || "",
      avatar: profile[ProfileFields.AVATAR] || ""
    };
    memberProfilesMap.set(member.user_id, member);
  }

  // Enrich updates with profile data from member profiles
  const enrichedUpdates: EnrichedUpdate[] = updates.map(update => {
    const profile = memberProfilesMap.get(update.created_by);
    if (!profile) {
      logger.warn(`Missing profile data for update ${update.update_id} created by ${update.created_by}`);
    }

    const enrichedUpdate: EnrichedUpdate = {
      ...update,
      username: profile?.username || "",
      name: profile?.name || "",
      avatar: profile?.avatar || ""
    };
    return enrichedUpdate;
  });

  // Set up pagination for the next request
  const nextCursor = generateNextCursor(lastDoc, enrichedUpdates.length, limit);

  logger.info(`Retrieved ${enrichedUpdates.length} updates for group: ${groupId}`);

  // Return the response
  const response: FeedResponse = {
    updates: enrichedUpdates,
    next_cursor: nextCursor
  };

  res.json(response);
}; 