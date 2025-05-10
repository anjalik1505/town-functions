import { Request, Response } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { Collections, GroupFields, ProfileFields } from '../models/constants.js';
import { GroupMember, GroupMembersResponse } from '../models/data-models.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Retrieves all members of a specific group with their basic profile information.
 *
 * This function fetches the group document to get the member information. If the group
 * has denormalized member_profiles, it uses that data directly.
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 * @param res - The Express response object
 * @param groupId - The ID of the group to retrieve members for
 *
 * @returns A GroupMembersResponse containing:
 * - A list of GroupMember objects with each member's profile information
 *
 * @throws 404: Group not found
 * @throws 403: User is not a member of the group
 * @throws 500: Internal server error
 */
export const getGroupMembers = async (
  req: Request,
  res: Response,
  groupId: string,
): Promise<void> => {
  logger.info(`Retrieving members for group: ${groupId}`);

  // Get the authenticated user ID from the request
  const currentUserId = req.userId;

  // Initialize Firestore client
  const db = getFirestore();

  // Get the group document
  const groupRef = db.collection(Collections.GROUPS).doc(groupId);
  const groupDoc = await groupRef.get();

  if (!groupDoc.exists) {
    logger.warn(`Group ${groupId} not found`);
    throw new NotFoundError('Group not found');
  }

  const groupData = groupDoc.data() || {};
  const membersIds = groupData[GroupFields.MEMBERS] || [];

  // Check if the current user is a member of the group
  if (!membersIds.includes(currentUserId)) {
    logger.warn(`User ${currentUserId} is not a member of group ${groupId}`);
    throw new ForbiddenError(
      'You must be a member of the group to view its members',
    );
  }

  const members: GroupMember[] = [];

  // Check if we have denormalized member profiles available
  const memberProfiles = groupData[GroupFields.MEMBER_PROFILES] || [];

  if (memberProfiles.length > 0) {
    // Use the denormalized data
    logger.info(`Using denormalized member profiles for group: ${groupId}`);
    for (const profile of memberProfiles) {
      const member: GroupMember = {
        user_id: profile[ProfileFields.USER_ID] || '',
        username: profile[ProfileFields.USERNAME] || '',
        name: profile[ProfileFields.NAME] || '',
        avatar: profile[ProfileFields.AVATAR] || '',
      };
      members.push(member);
    }
  }

  logger.info(`Retrieved ${members.length} members for group: ${groupId}`);

  // Return the response
  const response: GroupMembersResponse = {
    members,
  };

  res.json(response);
};
