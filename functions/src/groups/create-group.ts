import { Request, Response } from 'express';
import { DocumentData, FieldValue, getFirestore, Timestamp, UpdateData } from 'firebase-admin/firestore';
import { Collections } from '../models/constants.js';
import { CreateGroupPayload, Group } from '../models/data-models.js';
import { GroupDoc, groupConverter, profileConverter, pf } from '../models/firestore/index.js';
import { BadRequestError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Create a new group, ensuring the current user is in the members list.
 *
 * This function:
 * 1. Validates that all members exist
 * 2. Ensures all members are friends with each other
 * 3. Creates the group and updates member profiles in a batch operation
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: The validated request parameters containing:
 *                - name: The name of the group
 *                - icon: (Optional) The icon for the group
 *                - members: (Optional) List of user IDs to add to the group
 * @param res - The Express response object
 *
 * @returns A Group object with the created group data
 *
 * @throws 400: Members are not all friends with each other
 * @throws 404: Member profile not found
 * @throws 500: Internal server error
 */
export const createGroup = async (req: Request, res: Response): Promise<void> => {
  // Get the current user ID from the request (set by authentication middleware)
  const currentUserId = req.userId;

  // Get the validated request data
  const validatedParams = req.validated_params as CreateGroupPayload;
  logger.info(`Creating new group with name: ${validatedParams.name}`);

  // Extract group data
  const name = validatedParams.name;
  const icon = validatedParams.icon;
  const members = validatedParams.members || [];

  // Ensure current user is in the members list
  if (!members.includes(currentUserId)) {
    members.push(currentUserId);
  }

  const db = getFirestore();

  // Skip current user in validation since we know they exist
  const membersToValidate = members.filter((memberId: string) => memberId !== currentUserId);

  // Store profile data for denormalization as a Record
  const memberProfiles: Record<string, { username: string; name: string; avatar: string }> = {};

  // First, add the current user's profile (we know they exist)
  const currentUserProfile = await db
    .collection(Collections.PROFILES)
    .withConverter(profileConverter)
    .doc(currentUserId)
    .get();
  if (currentUserProfile.exists) {
    const profileData = currentUserProfile.data();
    if (profileData) {
      memberProfiles[currentUserId] = {
        username: profileData.username || '',
        name: profileData.name || '',
        avatar: profileData.avatar || '',
      };
    }
  }

  if (membersToValidate.length > 0) {
    // 1. Verify members exist
    const profilesCollection = db.collection(Collections.PROFILES).withConverter(profileConverter);
    const memberProfileRefs = membersToValidate.map((memberId: string) => profilesCollection.doc(memberId));
    const memberProfilesData = await db.getAll(...memberProfileRefs);

    // Check if all member profiles exist
    const missingMembers = [];
    for (let i = 0; i < memberProfilesData.length; i++) {
      const profileSnapshot = memberProfilesData[i];
      if (!profileSnapshot?.exists) {
        missingMembers.push(membersToValidate[i]);
      } else {
        // Store profile data for denormalization
        const profileData = profileSnapshot?.data();
        if (profileData) {
          memberProfiles[profileSnapshot?.id] = {
            username: profileData.username || '',
            name: profileData.name || '',
            avatar: profileData.avatar || '',
          };
        }
      }
    }

    if (missingMembers.length > 0) {
      const missingMembersStr = missingMembers.join(', ');
      logger.warn(`Member profiles not found: ${missingMembersStr}`);
      throw new NotFoundError(`Member profiles not found: ${missingMembersStr}`);
    }

    // 2. Check friendships using FRIENDS subcollection
    // We need to verify that all members are friends with each other
    // A friendship exists if both users have each other in their FRIENDS subcollection

    // Track missing friendships
    const missingFriendships: Array<[string, string]> = [];

    // Check all possible member pairs
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const member1 = members[i]!;
        const member2 = members[j]!;

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

    if (missingFriendships.length > 0) {
      // Format the error message
      const notFriendsStr = missingFriendships.map(([id1, id2]) => `${id1} and ${id2}`).join(', ');
      logger.warn(`Members are not friends: ${notFriendsStr}`);
      throw new BadRequestError('All members must be friends with each other to be in the same group');
    }
  }

  // All validations passed, now create the group

  // Create the group document reference
  const groupRef = db.collection(Collections.GROUPS).doc();
  const groupId = groupRef.id;

  // Generate a unique group ID
  logger.info(`Validation passed, creating group with ID: ${groupId}`);

  const currentTime = Timestamp.now();

  // Prepare group data
  const groupData: GroupDoc = {
    name: name,
    icon: icon || '',
    members: members,
    member_profiles: memberProfiles,
    created_at: currentTime,
  };

  // Create a batch operation for all database writes
  const batch = db.batch();

  // Add the group to Firestore with converter
  const groups = db.collection(Collections.GROUPS).withConverter(groupConverter);
  const typedGroupRef = groups.doc(groupId);
  batch.set(typedGroupRef, groupData);
  logger.info(`Adding group ${groupId} with name '${name}' to batch`);

  // Add the group ID to each member's profile
  for (const memberId of members) {
    const profileRef = db.collection(Collections.PROFILES).doc(memberId);
    const profileUpdate: UpdateData<DocumentData> = {
      [pf('group_ids')]: FieldValue.arrayUnion(groupId),
    };
    batch.update(profileRef, profileUpdate);
    logger.info(`Adding group ${groupId} to member ${memberId}'s profile in batch`);
  }

  // Execute the batch operation
  await batch.commit();
  logger.info(`Batch committed successfully: created group ${groupId} and updated all member profiles`);

  // Convert member_profiles from Record to array format for the response
  const memberProfilesArray = Object.entries(memberProfiles).map(([userId, profile]) => ({
    user_id: userId,
    username: profile.username,
    name: profile.name,
    avatar: profile.avatar,
  }));

  // Return the created group data
  const response: Group = {
    group_id: groupId,
    name,
    icon: icon || '', // Ensure icon is always a string for the response
    members,
    member_profiles: memberProfilesArray,
    created_at: formatTimestamp(currentTime),
  };

  res.json(response);
};
