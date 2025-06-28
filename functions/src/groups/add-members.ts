import { Request, Response } from 'express';
import { DocumentData, FieldValue, getFirestore, UpdateData } from 'firebase-admin/firestore';
import { Collections } from '../models/constants.js';
import { AddGroupMembersPayload, Group } from '../models/data-models.js';
import { groupConverter, pf, profileConverter } from '../models/firestore/index.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Add new members to an existing group.
 *
 * This function:
 * 1. Verifies the group exists and the current user is member
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
export const addMembersToGroup = async (req: Request, res: Response, groupId: string): Promise<void> => {
  logger.info(`Adding members to group: ${groupId}`);

  // Get the current user ID from the request (set by authentication middleware)
  const currentUserId = req.userId;

  // Get the validated request data
  const validatedParams = req.validated_params as AddGroupMembersPayload;

  // Extract new members to add
  const newMembers = validatedParams?.members || [];

  if (!newMembers.length) {
    logger.warn('No members provided to add to the group');
    throw new BadRequestError('No members provided to add to the group');
  }

  const db = getFirestore();

  // 1. Check if the group exists and the current user is a member
  const groupRef = db.collection(Collections.GROUPS).withConverter(groupConverter).doc(groupId);
  const groupDoc = await groupRef.get();

  const groupData = groupDoc.data();
  if (!groupData) {
    logger.warn(`Group ${groupId} not found`);
    throw new NotFoundError('Group not found');
  }

  const currentMembers = groupData.members || [];

  if (!currentMembers.includes(currentUserId)) {
    logger.warn(`User ${currentUserId} is not a member of group ${groupId}`);
    throw new ForbiddenError('You must be a member of the group to add new members');
  }

  // 2. Filter out members who are already in the group
  const newMembersToAdd = newMembers.filter((memberId: string) => !currentMembers.includes(memberId));

  if (!newMembersToAdd.length) {
    logger.warn('All provided members are already in the group');
    throw new BadRequestError('All provided members are already in the group');
  }

  // 3. Verify new members exist
  const profilesCollection = db.collection(Collections.PROFILES).withConverter(profileConverter);
  const newMemberProfileRefs = newMembersToAdd.map((memberId: string) => profilesCollection.doc(memberId));
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

  // 4. Check friendships using FRIENDS subcollection
  // We need to verify that all new members are friends with all existing members
  // A friendship exists if both users have each other in their FRIENDS subcollection

  // Track missing friendships
  const missingFriendships: Array<[string, string]> = [];

  // Check if each new member is friends with all existing members
  for (const newMemberId of newMembersToAdd) {
    for (const currentMemberId of currentMembers) {
      // Skip self-comparison (shouldn't happen, but just in case)
      if (newMemberId === currentMemberId) {
        continue;
      }

      // Check if newMember has currentMember in their friends subcollection
      const newMemberFriendRef = db
        .collection(Collections.PROFILES)
        .doc(newMemberId)
        .collection(Collections.FRIENDS)
        .doc(currentMemberId);
      const newMemberFriendDoc = await newMemberFriendRef.get();

      // Check if currentMember has newMember in their friends subcollection
      const currentMemberFriendRef = db
        .collection(Collections.PROFILES)
        .doc(currentMemberId)
        .collection(Collections.FRIENDS)
        .doc(newMemberId);
      const currentMemberFriendDoc = await currentMemberFriendRef.get();

      // Both documents must exist for a valid friendship
      if (!newMemberFriendDoc.exists || !currentMemberFriendDoc.exists) {
        missingFriendships.push([newMemberId, currentMemberId]);
      }
    }
  }

  // Also check if all new members are friends with each other
  for (let i = 0; i < newMembersToAdd.length; i++) {
    for (let j = i + 1; j < newMembersToAdd.length; j++) {
      const member1 = newMembersToAdd[i]!;
      const member2 = newMembersToAdd[j]!;

      // Check if member1 has member2 in their friends subcollection
      const member1FriendRef = db
        .collection(Collections.PROFILES)
        .doc(member1)
        .collection(Collections.FRIENDS)
        .doc(member2);
      const member1FriendDoc = await member1FriendRef.get();

      // Check if member2 has member1 in their friends subcollection
      const member2FriendRef = db
        .collection(Collections.PROFILES)
        .doc(member2)
        .collection(Collections.FRIENDS)
        .doc(member1);
      const member2FriendDoc = await member2FriendRef.get();

      // Both documents must exist for a valid friendship
      if (!member1FriendDoc.exists || !member2FriendDoc.exists) {
        missingFriendships.push([member1, member2]);
      }
    }
  }

  if (missingFriendships.length) {
    // Format the error message
    const notFriendsStr = missingFriendships.map(([id1, id2]) => `${id1} and ${id2}`).join(', ');
    logger.warn(`Members are not friends: ${notFriendsStr}`);
    throw new BadRequestError('All members must be friends with each other to be in the same group');
  }

  // All validations passed, now update the group

  // Create a batch operation for all database writes
  const batch = db.batch();

  // Update the group with the new members
  const updatedMembers = [...currentMembers, ...newMembersToAdd];

  // Get the existing member profiles as a Record
  const existingMemberProfiles = groupData.member_profiles || {};

  // Get profile information for new members to add to denormalized data
  const newMemberProfileData: Record<string, { username: string; name: string; avatar: string }> = {};
  newMemberProfiles
    .filter((profile) => profile.exists)
    .forEach((profile) => {
      const profileData = profile.data();
      if (profileData) {
        newMemberProfileData[profile.id] = {
          username: profileData.username || '',
          name: profileData.name || '',
          avatar: profileData.avatar || '',
        };
      }
    });

  // Combine existing and new member profiles
  const updatedMemberProfiles = { ...existingMemberProfiles, ...newMemberProfileData };

  // Update the group document with both members array and denormalized profiles
  const groupUpdate: UpdateData<DocumentData> = {
    members: updatedMembers,
    member_profiles: updatedMemberProfiles,
  };
  batch.update(groupRef, groupUpdate);
  logger.info(`Adding ${newMembersToAdd.length} new members to group ${groupId}`);

  // Add the group ID to each new member's profile
  for (const memberId of newMembersToAdd) {
    const profileRef = db.collection(Collections.PROFILES).doc(memberId);
    const profileUpdate: UpdateData<DocumentData> = {
      [pf('group_ids')]: FieldValue.arrayUnion(groupId),
    };
    batch.update(profileRef, profileUpdate);
    logger.info(`Adding group ${groupId} to member ${memberId}'s profile`);
  }

  // Execute the batch operation
  await batch.commit();
  logger.info(`Batch committed successfully: updated group ${groupId} and member profiles`);

  // Get the updated group data
  const updatedGroupDoc = await groupRef.get();
  const updatedGroupData = updatedGroupDoc.data();

  if (!updatedGroupData) {
    throw new Error('Failed to retrieve updated group data');
  }

  // Convert member_profiles from Record to array format for the response
  const memberProfilesArray = Object.entries(updatedGroupData.member_profiles || {}).map(([userId, profile]) => ({
    user_id: userId,
    username: profile.username,
    name: profile.name,
    avatar: profile.avatar,
  }));

  // Return the updated group data
  const response: Group = {
    group_id: groupId,
    name: updatedGroupData.name || '',
    icon: updatedGroupData.icon || '',
    members: updatedGroupData.members || [],
    member_profiles: memberProfilesArray,
    created_at: updatedGroupData.created_at ? formatTimestamp(updatedGroupData.created_at) : '',
  };

  res.json(response);
};
