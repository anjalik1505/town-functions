import { Request, Response } from 'express';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { v4 as uuidv4 } from 'uuid';
import {
  Collections,
  FriendshipFields,
  GroupFields,
  MAX_BATCH_SIZE,
  ProfileFields,
  QueryOperators,
  Status,
} from '../models/constants';
import { Group } from '../models/data-models';
import { BadRequestError, NotFoundError } from '../utils/errors';
import { getLogger } from '../utils/logging-utils';
import { formatTimestamp } from '../utils/timestamp-utils';

const logger = getLogger(__filename);

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
export const createGroup = async (
  req: Request,
  res: Response,
): Promise<void> => {
  logger.info(`Creating new group with name: ${req.validated_params.name}`);

  // Get the current user ID from the request (set by authentication middleware)
  const currentUserId = req.userId;

  // Get the validated request data
  const validatedParams = req.validated_params;

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
  const membersToValidate = members.filter(
    (memberId: string) => memberId !== currentUserId,
  );

  // Store profile data for denormalization
  const memberProfiles = [];

  // First, add the current user's profile (we know they exist)
  const currentUserProfile = await db
    .collection(Collections.PROFILES)
    .doc(currentUserId)
    .get();
  if (currentUserProfile.exists) {
    const profileData = currentUserProfile.data() || {};
    memberProfiles.push({
      [ProfileFields.USER_ID]: currentUserId,
      [ProfileFields.USERNAME]: profileData[ProfileFields.USERNAME] || '',
      [ProfileFields.NAME]: profileData[ProfileFields.NAME] || '',
      [ProfileFields.AVATAR]: profileData[ProfileFields.AVATAR] || '',
    });
  }

  if (membersToValidate.length > 0) {
    // 1. Verify members exist
    const memberProfileRefs = membersToValidate.map((memberId: string) =>
      db.collection(Collections.PROFILES).doc(memberId),
    );
    const memberProfilesData = await db.getAll(...memberProfileRefs);

    // Check if all member profiles exist
    const missingMembers = [];
    for (let i = 0; i < memberProfilesData.length; i++) {
      const profileSnapshot = memberProfilesData[i];
      if (!profileSnapshot?.exists) {
        missingMembers.push(membersToValidate[i]);
      } else {
        // Store profile data for denormalization
        const profileData = profileSnapshot?.data() || {};
        memberProfiles.push({
          [ProfileFields.USER_ID]: profileSnapshot?.id,
          [ProfileFields.USERNAME]: profileData[ProfileFields.USERNAME] || '',
          [ProfileFields.NAME]: profileData[ProfileFields.NAME] || '',
          [ProfileFields.AVATAR]: profileData[ProfileFields.AVATAR] || '',
        });
      }
    }

    if (missingMembers.length > 0) {
      const missingMembersStr = missingMembers.join(', ');
      logger.warn(`Member profiles not found: ${missingMembersStr}`);
      throw new NotFoundError(
        `Member profiles not found: ${missingMembersStr}`,
      );
    }

    // 2. Optimized friendship check using batch fetching
    // We need to verify that all members are friends with each other

    // Create a dictionary to track friendships
    // Key: tuple of (user1_id, user2_id) where user1_id < user2_id (for consistent ordering)
    // Value: True if friendship exists, False otherwise
    const friendshipExists: Record<string, boolean> = {};

    // Initialize all possible member pairs as not friends
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const member1 = members[i];
        const member2 = members[j];
        const pair =
          member1 < member2 ? `${member1}_${member2}` : `${member2}_${member1}`;
        friendshipExists[pair] = false;
      }
    }

    // Firestore allows up to 10 values in array_contains_any
    // We'll process members in batches of 10 if needed
    for (let i = 0; i < members.length; i += MAX_BATCH_SIZE) {
      const batchMembers = members.slice(i, i + MAX_BATCH_SIZE);

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

        // Check which group members are in this friendship
        const friendshipGroupMembers = members.filter((m: string) =>
          membersInFriendship.includes(m),
        );

        // If we found at least 2 group members in this friendship, mark them as friends
        if (friendshipGroupMembers.length >= 2) {
          for (let x = 0; x < friendshipGroupMembers.length; x++) {
            for (let y = x + 1; y < friendshipGroupMembers.length; y++) {
              const member1 = friendshipGroupMembers[x];
              const member2 = friendshipGroupMembers[y];
              const pair =
                member1 < member2
                  ? `${member1}_${member2}`
                  : `${member2}_${member1}`;
              if (pair in friendshipExists) {
                friendshipExists[pair] = true;
              }
            }
          }
        }
      }
    }

    // Check if any member pairs are not friends
    const notFriends = Object.entries(friendshipExists)
      .filter(([_, exists]) => !exists)
      .map(([pair]) => pair.split('_'));

    if (notFriends.length > 0) {
      // Format the error message
      const notFriendsStr = notFriends
        .map(([id1, id2]) => `${id1} and ${id2}`)
        .join(', ');
      logger.warn(`Members are not friends: ${notFriendsStr}`);
      throw new BadRequestError(
        'All members must be friends with each other to be in the same group',
      );
    }
  }

  // All validations passed, now create the group

  // Generate a unique group ID
  const groupId = uuidv4();
  logger.info(`Validation passed, creating group with ID: ${groupId}`);

  // Create the group document reference
  const groupRef = db.collection(Collections.GROUPS).doc(groupId);

  const currentTime = Timestamp.now();

  // Prepare group data
  const groupData = {
    [GroupFields.NAME]: name,
    [GroupFields.ICON]: icon,
    [GroupFields.MEMBERS]: members,
    [GroupFields.MEMBER_PROFILES]: memberProfiles,
    [GroupFields.CREATED_AT]: currentTime,
  };

  // Create a batch operation for all database writes
  const batch = db.batch();

  // Add the group to Firestore
  batch.set(groupRef, groupData);
  logger.info(`Adding group ${groupId} with name '${name}' to batch`);

  // Add the group ID to each member's profile
  for (const memberId of members) {
    const profileRef = db.collection(Collections.PROFILES).doc(memberId);
    batch.update(profileRef, {
      [ProfileFields.GROUP_IDS]: FieldValue.arrayUnion(groupId),
    });
    logger.info(
      `Adding group ${groupId} to member ${memberId}'s profile in batch`,
    );
  }

  // Execute the batch operation
  await batch.commit();
  logger.info(
    `Batch committed successfully: created group ${groupId} and updated all member profiles`,
  );

  // Return the created group data
  const response: Group = {
    group_id: groupId,
    name,
    icon,
    members,
    member_profiles: memberProfiles,
    created_at: formatTimestamp(currentTime),
  };

  res.json(response);
};
