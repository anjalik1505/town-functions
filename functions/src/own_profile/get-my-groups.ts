import { Request, Response } from 'express';
import { getFirestore, QueryDocumentSnapshot, WhereFilterOp } from 'firebase-admin/firestore';
import { Collections, QueryOperators } from '../models/constants.js';
import { Group, GroupsResponse } from '../models/data-models.js';
import { GroupDoc, groupConverter, gf } from '../models/firestore/index.js';
import { getLogger } from '../utils/logging-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Retrieves all groups where the current user is a member.
 *
 * This function queries the group collection to find all groups that have the
 * authenticated user's ID in their member array. For each group, it retrieves
 * the basic information (groupId, name, icon, created_at).
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 * @param res - The Express response object
 *
 * @returns A GroupsResponse containing:
 * - A list of Group objects with basic information for each group
 */
export const getMyGroups = async (req: Request, res: Response): Promise<void> => {
  const currentUserId = req.userId;
  logger.info(`Retrieving groups for user: ${currentUserId}`);

  const db = getFirestore();

  // Get all groups where the user is a member
  const groupsCol = db.collection(Collections.GROUPS).withConverter(groupConverter);
  const groupsQuery = groupsCol.where(gf('members'), QueryOperators.ARRAY_CONTAINS as WhereFilterOp, currentUserId);

  logger.info(`Querying groups for user: ${currentUserId}`);

  const groups: Group[] = [];

  // Process each group as it streams in
  for await (const doc of groupsQuery.stream()) {
    const groupDoc = doc as unknown as QueryDocumentSnapshot<GroupDoc>;
    const groupData = groupDoc.data();
    const groupId = groupDoc.id;
    logger.info(`Processing group: ${groupId}`);

    // Convert member_profiles from Record to array format
    const memberProfilesArray = Object.entries(groupData.member_profiles || {}).map(([userId, profile]) => ({
      user_id: userId,
      username: profile.username,
      name: profile.name,
      avatar: profile.avatar,
    }));

    groups.push({
      group_id: groupId,
      name: groupData.name || '',
      icon: groupData.icon || '',
      members: groupData.members || [],
      created_at: groupData.created_at ? formatTimestamp(groupData.created_at) : '',
      member_profiles: memberProfilesArray,
    });
    logger.info(`Added group ${groupId} to results`);
  }

  logger.info(`Retrieved ${groups.length} groups for user: ${currentUserId}`);

  // Return the list of groups
  const response: GroupsResponse = { groups };
  res.json(response);
};
