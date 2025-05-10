import { Request, Response } from 'express';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  Collections,
  FriendshipFields,
  GroupFields,
  MAX_BATCH_SIZE,
  ProfileFields,
  QueryOperators,
  Status,
} from '../models/constants.js';
import { Group } from '../models/data-models.js';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
} from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Add new members to an existing group.
 *
 * This function:
 * 1. Verifies the group exists and the current user is a member
 * 2. Validates that all new members exist
 * 3. Ensures all members are friends with each other
 * 4. Updates the group and member profiles in a batch operation
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: The validated request parameters containing:
 *                - members: List of user IDs to add to the group
 * @param res - The Express response object
 * @param groupId - The ID of the group to add members to
 *
 * @returns A Group object with the updated group data
 *
 * @throws 400: Members are not all friends with each other
 * @throws 403: User is not a member of the group
 * @throws 404: Group not found or member profile not found
 * @throws 500: Internal server error
 */
export const addMembersToGroup = async (
  req: Request,
  res: Response,
  groupId: string,
): Promise<void> => {
  logger.info(`Adding members to group: ${groupId}`);

  // Get the current user ID from the request (set by authentication middleware)
  const currentUserId = req.userId;

  // Get the validated request data
  const validatedParams = req.validated_params;

  // Extract new members to add
  const newMembers = validatedParams?.members || [];

  if (!newMembers.length) {
    logger.warn('No members provided to add to the group');
    throw new BadRequestError('No members provided to add to the group');
  }

  const db = getFirestore();

  // 1. Check if the group exists and the current user is a member
  const groupRef = db.collection(Collections.GROUPS).doc(groupId);
  const groupDoc = await groupRef.get();

  if (!groupDoc.exists) {
    logger.warn(`Group ${groupId} not found`);
    throw new NotFoundError('Group not found');
  }

  const groupData = groupDoc.data() || {};
  const currentMembers = groupData[GroupFields.MEMBERS] || [];

  if (!currentMembers.includes(currentUserId)) {
    logger.warn(`User ${currentUserId} is not a member of group ${groupId}`);
    throw new ForbiddenError(
      'You must be a member of the group to add new members',
    );
  }

  // 2. Filter out members who are already in the group
  const newMembersToAdd = newMembers.filter(
    (memberId: string) => !currentMembers.includes(memberId),
  );

  if (!newMembersToAdd.length) {
    logger.warn('All provided members are already in the group');
    throw new BadRequestError('All provided members are already in the group');
  }

  // 3. Verify new members exist
  const newMemberProfileRefs = newMembersToAdd.map((memberId: string) =>
    db.collection(Collections.PROFILES).doc(memberId),
  );
  const newMemberProfiles = await db.getAll(...newMemberProfileRefs);

  // Check if all new member profiles exist
  const missingMembers = newMemberProfiles
    .map((profile, index) => (profile.exists ? null : newMembersToAdd[index]))
    .filter((memberId): memberId is string => memberId !== null);

  if (missingMembers.length) {
    const missingMembersStr = missingMembers.join(', ');
    logger.warn(`Member profiles not found: ${missingMembersStr}`);
    throw new NotFoundError(`Member profiles not found: ${missingMembersStr}`);
  }

  // 4. Optimized friendship check using batch fetching
  // We need to verify that all new members are friends with all existing members

  // Create a dictionary to track friendships
  // Key: tuple of (user1_id, user2_id) where user1_id < user2_id (for consistent ordering)
  // Value: True if friendship exists, False otherwise
  const friendshipExists: Record<string, boolean> = {};

  // Initialize all possible member pairs as not friends
  for (const newMemberId of newMembersToAdd) {
    for (const currentMemberId of currentMembers) {
      // Skip self-comparison
      if (newMemberId === currentMemberId) {
        continue;
      }
      // Ensure consistent ordering of the pair
      const pair =
        newMemberId < currentMemberId
          ? `${newMemberId}_${currentMemberId}`
          : `${currentMemberId}_${newMemberId}`;
      friendshipExists[pair] = false;
    }
  }

  // Combine all members that need to be checked
  const allMembersToCheck = [
    ...new Set([...newMembersToAdd, ...currentMembers]),
  ];
  // Firestore allows up to 10 values in array_contains_any
  // We'll process members in batches of 10 if needed
  for (let i = 0; i < allMembersToCheck.length; i += MAX_BATCH_SIZE) {
    const batchMembers = allMembersToCheck.slice(i, i + MAX_BATCH_SIZE);

    // Fetch all friendships where any of the batch members is in the members array
    const friendshipsQuery = db
      .collection(Collections.FRIENDSHIPS)
      .where(
        FriendshipFields.MEMBERS,
        QueryOperators.ARRAY_CONTAINS_ANY as any,
        batchMembers,
      )
      .where(FriendshipFields.STATUS, QueryOperators.EQUALS, Status.ACCEPTED);

    const friendshipsSnapshot = await friendshipsQuery.get();
    logger.info(
      `Fetched ${friendshipsSnapshot.docs.length} friendships for batch of ${batchMembers.length} members`,
    );

    // Process each friendship to mark member pairs as friends
    for (const doc of friendshipsSnapshot.docs) {
      const friendshipData = doc.data();
      const membersInFriendship =
        friendshipData[FriendshipFields.MEMBERS] || [];

      // Check which members are in this friendship
      for (const member1 of membersInFriendship) {
        for (const member2 of membersInFriendship) {
          if (member1 < member2) {
            // Only process each pair once
            const pair = `${member1}_${member2}`;
            if (pair in friendshipExists) {
              friendshipExists[pair] = true;
            }
          }
        }
      }
    }
  }

  // Check if any required member pairs are not friends
  const notFriends = Object.entries(friendshipExists)
    .filter(([_, exists]) => !exists)
    .map(([pair]) => pair.split('_'));

  if (notFriends.length) {
    // Format the error message
    const notFriendsStr = notFriends
      .map(([id1, id2]) => `${id1} and ${id2}`)
      .join(', ');
    logger.warn(`Members are not friends: ${notFriendsStr}`);
    throw new BadRequestError(
      'All members must be friends with each other to be in the same group',
    );
  }

  // All validations passed, now update the group

  // Create a batch operation for all database writes
  const batch = db.batch();

  // Update the group with the new members
  const updatedMembers = [...currentMembers, ...newMembersToAdd];

  // Get the existing member profiles
  const existingMemberProfiles = groupData[GroupFields.MEMBER_PROFILES] || [];

  // Get profile information for new members to add to denormalized data
  const newMemberProfileData = newMemberProfiles
    .filter((profile) => profile.exists)
    .map((profile) => {
      const profileData = profile.data() || {};
      return {
        [ProfileFields.USER_ID]: profile.id,
        [ProfileFields.USERNAME]: profileData[ProfileFields.USERNAME] || '',
        [ProfileFields.NAME]: profileData[ProfileFields.NAME] || '',
        [ProfileFields.AVATAR]: profileData[ProfileFields.AVATAR] || '',
      };
    });

  // Combine existing and new member profiles
  const updatedMemberProfiles = [
    ...existingMemberProfiles,
    ...newMemberProfileData,
  ];

  // Update the group document with both members array and denormalized profiles
  batch.update(groupRef, {
    [GroupFields.MEMBERS]: updatedMembers,
    [GroupFields.MEMBER_PROFILES]: updatedMemberProfiles,
  });
  logger.info(
    `Adding ${newMembersToAdd.length} new members to group ${groupId}`,
  );

  // Add the group ID to each new member's profile
  for (const memberId of newMembersToAdd) {
    const profileRef = db.collection(Collections.PROFILES).doc(memberId);
    batch.update(profileRef, {
      [ProfileFields.GROUP_IDS]: FieldValue.arrayUnion(groupId),
    });
    logger.info(`Adding group ${groupId} to member ${memberId}'s profile`);
  }

  // Execute the batch operation
  await batch.commit();
  logger.info(
    `Batch committed successfully: updated group ${groupId} and member profiles`,
  );

  // Get the updated group data
  const updatedGroupDoc = await groupRef.get();
  const updatedGroupData = updatedGroupDoc.data() || {};

  // Return the updated group data
  const response: Group = {
    group_id: groupId,
    name: updatedGroupData[GroupFields.NAME] || '',
    icon: updatedGroupData[GroupFields.ICON] || '',
    members: updatedGroupData[GroupFields.MEMBERS] || [],
    member_profiles: updatedGroupData[GroupFields.MEMBER_PROFILES] || [],
    created_at: updatedGroupData[GroupFields.CREATED_AT]
      ? formatTimestamp(updatedGroupData[GroupFields.CREATED_AT])
      : '',
  };

  res.json(response);
};
