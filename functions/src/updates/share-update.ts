import { Request } from 'express';
import { DocumentData, getFirestore, Timestamp, UpdateData } from 'firebase-admin/firestore';
import { ApiResponse, EventName, ShareUpdateEventParams } from '../models/analytics-events.js';
import { Collections, GroupFields, UpdateFields } from '../models/constants.js';
import { BaseGroup, BaseUser, ShareUpdatePayload, Update } from '../models/data-models.js';
import { BadRequestError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { fetchUsersProfiles } from '../utils/profile-utils.js';
import { fetchGroupProfiles, formatUpdate } from '../utils/update-utils.js';
import { createFriendVisibilityIdentifiers, createGroupVisibilityIdentifiers } from '../utils/visibility-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Shares an existing update with additional friends and groups.
 *
 * This function:
 * 1. Validates that the update exists and the user owns it
 * 2. Updates the update document with new friend and group IDs
 * 3. Updates the visible_to array for efficient querying
 * 4. The actual processing (friend summaries and feed items) is handled by the trigger
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params.update_id: The ID of the update to share
 *              - validated_params: The validated request data containing:
 *                - friend_ids: List of friend IDs to share the update with
 *                - group_ids: List of group IDs to share the update with
 *
 * @returns A Promise that resolves to the updated Update object
 */
export const shareUpdate = async (req: Request): Promise<ApiResponse<Update>> => {
  const updateId = req.params.update_id;
  const currentUserId = req.userId;

  if (!updateId) {
    throw new BadRequestError('Update ID is required');
  }

  // Get validated data from the request
  const validatedParams = req.validated_params as ShareUpdatePayload;
  const newFriendIds = validatedParams.friend_ids || [];
  const newGroupIds = validatedParams.group_ids || [];

  logger.info(
    `Sharing update ${updateId} with ${newFriendIds.length} additional friends and ${newGroupIds.length} additional groups for user: ${currentUserId}`,
  );

  // Initialize Firestore client
  const db = getFirestore();

  // Get the update document
  const updateRef = db.collection(Collections.UPDATES).doc(updateId);
  const updateDoc = await updateRef.get();

  if (!updateDoc.exists) {
    throw new NotFoundError('Update not found');
  }

  const updateData = updateDoc.data();
  if (!updateData) {
    throw new NotFoundError('Update data not found');
  }

  // Verify that the current user is the owner of the update
  if (updateData[UpdateFields.CREATED_BY] !== currentUserId) {
    throw new ForbiddenError('You can only share your own updates');
  }

  // Get current friend IDs and group IDs
  const currentFriendIds = (updateData[UpdateFields.FRIEND_IDS] as string[]) || [];
  const currentGroupIds = (updateData[UpdateFields.GROUP_IDS] as string[]) || [];
  const currentVisibleTo = (updateData[UpdateFields.VISIBLE_TO] as string[]) || [];

  // Filter out friend IDs and group IDs that are already in the update
  const friendsToAdd = newFriendIds.filter((friendId) => !currentFriendIds.includes(friendId));
  const groupsToAdd = newGroupIds.filter((groupId) => !currentGroupIds.includes(groupId));

  const sharedWithFriends = (updateData.shared_with_friends_profiles as BaseUser[]) || [];
  const sharedWithGroups = (updateData.shared_with_groups_profiles as BaseGroup[]) || [];

  if (friendsToAdd.length === 0 && groupsToAdd.length === 0) {
    const response = formatUpdate(updateId, updateData, currentUserId, [], sharedWithFriends, sharedWithGroups);

    return {
      data: response,
      status: 200,
      analytics: {
        event: EventName.UPDATE_SHARED,
        userId: currentUserId,
        params: {
          new_friends_count: 0,
          total_friends_count: currentFriendIds.length,
          new_groups_count: 0,
          total_groups_count: currentGroupIds.length,
        },
      },
    };
  }

  // Verify that the user is a member of the groups they're trying to add
  if (groupsToAdd.length > 0) {
    const groupDocs = await Promise.all(
      groupsToAdd.map((groupId) => db.collection(Collections.GROUPS).doc(groupId).get()),
    );

    for (const groupDoc of groupDocs) {
      if (!groupDoc.exists) {
        throw new NotFoundError(`Group ${groupDoc.id} not found`);
      }

      const groupData = groupDoc.data();
      const members = (groupData?.[GroupFields.MEMBERS] as string[]) || [];

      if (!members.includes(currentUserId)) {
        throw new ForbiddenError(`You are not a member of group ${groupDoc.id}`);
      }
    }
  }

  // Prepare the updated friend IDs and group IDs
  const updatedFriendIds = [...currentFriendIds, ...friendsToAdd];
  const updatedGroupIds = [...currentGroupIds, ...groupsToAdd];

  // Prepare the updated visible_to array
  const newFriendVisibilityIdentifiers = createFriendVisibilityIdentifiers(friendsToAdd);
  const newGroupVisibilityIdentifiers = createGroupVisibilityIdentifiers(groupsToAdd);
  const updatedVisibleTo = [...currentVisibleTo, ...newFriendVisibilityIdentifiers, ...newGroupVisibilityIdentifiers];

  // Fetch profiles only for newly added friends and groups
  const [newFriendProfiles, newGroupProfiles] = await Promise.all([
    fetchUsersProfiles(friendsToAdd),
    fetchGroupProfiles(groupsToAdd),
  ]);

  // Convert new friend profiles from Map to array format
  const newFriendProfilesArray: BaseUser[] = Array.from(newFriendProfiles.entries()).map(([userId, profile]) => ({
    user_id: userId,
    username: profile.username,
    name: profile.name,
    avatar: profile.avatar,
  }));

  // Since we only add (never remove), just combine existing and new profiles
  const updatedFriendProfiles = [...sharedWithFriends, ...newFriendProfilesArray];
  const updatedGroupProfiles = [...sharedWithGroups, ...newGroupProfiles];

  // Update the document
  const updateDocData: UpdateData<DocumentData> = {
    [UpdateFields.FRIEND_IDS]: updatedFriendIds,
    [UpdateFields.GROUP_IDS]: updatedGroupIds,
    [UpdateFields.VISIBLE_TO]: updatedVisibleTo,
    shared_with_friends_profiles: updatedFriendProfiles,
    shared_with_groups_profiles: updatedGroupProfiles,
    updated_at: Timestamp.now(),
  };

  await updateRef.update(updateDocData);

  logger.info(
    `Successfully shared update ${updateId} with ${friendsToAdd.length} new friends and ${groupsToAdd.length} new groups. ` +
      `Total friends now: ${updatedFriendIds.length}, Total groups now: ${updatedGroupIds.length}`,
  );

  // Format and return the complete update object
  // Merge the original update data with the updated fields
  const completeUpdateData = {
    ...updateData,
    ...updateDocData,
  };
  const response = formatUpdate(
    updateId,
    completeUpdateData,
    currentUserId,
    [],
    updatedFriendProfiles,
    updatedGroupProfiles,
  );

  const event: ShareUpdateEventParams = {
    new_friends_count: friendsToAdd.length,
    total_friends_count: updatedFriendIds.length,
    new_groups_count: groupsToAdd.length,
    total_groups_count: updatedGroupIds.length,
  };

  return {
    data: response,
    status: 200,
    analytics: {
      event: EventName.UPDATE_SHARED,
      userId: currentUserId,
      params: event,
    },
  };
};
