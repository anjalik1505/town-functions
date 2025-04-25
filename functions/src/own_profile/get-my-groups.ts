import { Request, Response } from "express";
import { getFirestore, QueryDocumentSnapshot, WhereFilterOp } from "firebase-admin/firestore";
import { Collections, GroupFields, QueryOperators } from "../models/constants";
import { Group, GroupsResponse } from "../models/data-models";
import { getLogger } from "../utils/logging-utils";
import { formatTimestamp } from "../utils/timestamp-utils";

const logger = getLogger(__filename);

/**
 * Retrieves all groups where the current user is a member.
 *
 * This function queries the groups collection to find all groups that have the
 * authenticated user's ID in their members array. For each group, it retrieves
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

  // Get all groups where user is a member
  const groupsQuery = db.collection(Collections.GROUPS)
    .where(GroupFields.MEMBERS, QueryOperators.ARRAY_CONTAINS as WhereFilterOp, currentUserId);

  logger.info(`Querying groups for user: ${currentUserId}`);

  const groups: Group[] = [];

  // Process each group as it streams in
  for await (const doc of groupsQuery.stream()) {
    const groupDoc = doc as unknown as QueryDocumentSnapshot;
    const groupData = groupDoc.data();
    const memberProfiles = groupData[GroupFields.MEMBER_PROFILES] || [];
    const groupId = groupDoc.id;
    logger.info(`Processing group: ${groupId}`);

    groups.push({
      group_id: groupId,
      name: groupData[GroupFields.NAME] || "",
      icon: groupData[GroupFields.ICON] || "",
      members: groupData[GroupFields.MEMBERS] || [],
      created_at: groupData[GroupFields.CREATED_AT] ? formatTimestamp(groupData[GroupFields.CREATED_AT]) : "",
      member_profiles: memberProfiles
    });
    logger.info(`Added group ${groupId} to results`);
  }

  logger.info(`Retrieved ${groups.length} groups for user: ${currentUserId}`);

  // Return the list of groups
  const response: GroupsResponse = { groups };
  res.json(response);
}; 