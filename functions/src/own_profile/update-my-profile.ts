import { Request } from 'express';
import {
  DocumentData,
  getFirestore,
  QueryDocumentSnapshot,
  Timestamp,
  UpdateData,
  WhereFilterOp,
} from 'firebase-admin/firestore';
import { ApiResponse, EventName, ProfileEventParams, } from '../models/analytics-events.js';
import {
  Collections,
  FriendshipFields,
  GroupFields,
  InvitationFields,
  ProfileFields,
  QueryOperators,
} from '../models/constants.js';
import { ProfileResponse, UpdateProfilePayload, } from '../models/data-models.js';
import { getLogger } from '../utils/logging-utils.js';
import { formatProfileResponse, getProfileDoc, getProfileInsights, } from '../utils/profile-utils.js';

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Updates the authenticated user's profile information.
 *
 * This function:
 * 1. Checks if a profile exists for the authenticated user
 * 2. Updates the profile with the provided data
 * 3. If username, name, or avatar changes, updates these fields in related collections:
 *    - Invitations
 *    - Friendships (both as sender and receiver)
 *    - Groups (in member_profiles)
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Profile data that can include:
 *                - username: Optional updated username
 *                - name: Optional updated display name
 *                - avatar: Optional updated avatar URL
 *                - location: Optional updated location information
 *                - birthday: Optional updated birthday in ISO format
 *                - notification_settings: Optional updated list of notification preferences
 *                - gender: Optional updated gender information
 *
 * @returns A ProfileResponse containing the updated profile information
 *
 * @throws 404: Profile not found
 */
export const updateProfile = async (
  req: Request,
): Promise<ApiResponse<ProfileResponse>> => {
  const currentUserId = req.userId;
  logger.info(
    `Starting update_profile operation for user ID: ${currentUserId}`,
  );

  const db = getFirestore();
  const profileData = req.validated_params as UpdateProfilePayload;

  // Get the profile document using the utility function
  const { ref: profileRef, data: currentProfileData } =
    await getProfileDoc(currentUserId);
  logger.info(`Retrieved current profile data for user ${currentUserId}`);

  // Check if the username, name, or avatar has changed
  const usernameChanged =
    profileData.username !== undefined &&
    profileData.username !== currentProfileData[ProfileFields.USERNAME];

  const nameChanged =
    profileData.name !== undefined &&
    profileData.name !== currentProfileData[ProfileFields.NAME];

  const avatarChanged =
    profileData.avatar !== undefined &&
    profileData.avatar !== currentProfileData[ProfileFields.AVATAR];

  // Prepare update data
  const profileUpdates: UpdateData<DocumentData> = {};

  // Only update fields that are provided in the request
  if (profileData.username !== undefined) {
    profileUpdates[ProfileFields.USERNAME] = profileData.username;
  }
  if (profileData.name !== undefined) {
    profileUpdates[ProfileFields.NAME] = profileData.name;
  }
  if (profileData.avatar !== undefined) {
    profileUpdates[ProfileFields.AVATAR] = profileData.avatar;
  }
  if (profileData.location !== undefined) {
    profileUpdates[ProfileFields.LOCATION] = profileData.location;
  }
  if (profileData.birthday !== undefined) {
    profileUpdates[ProfileFields.BIRTHDAY] = profileData.birthday;
  }
  if (profileData.notification_settings !== undefined) {
    profileUpdates[ProfileFields.NOTIFICATION_SETTINGS] =
      profileData.notification_settings;
  }
  if (profileData.gender !== undefined) {
    profileUpdates[ProfileFields.GENDER] = profileData.gender;
  }

  // Create a batch for all updates
  const batch = db.batch();

  // Update the profile in the batch
  if (Object.keys(profileUpdates).length > 0) {
    profileUpdates[ProfileFields.UPDATED_AT] = Timestamp.now();
    batch.update(profileRef, profileUpdates);
    logger.info(`Added profile update to batch for user ${currentUserId}`);
  }

  // If username, name, or avatar changed, update references in other collections
  if (usernameChanged || nameChanged || avatarChanged) {
    logger.info(
      `Updating username/name/avatar references for user ${currentUserId}`,
    );

    // 1. Update all invitations created by this user
    const invitationsQuery = db
      .collection(Collections.INVITATIONS)
      .where(InvitationFields.SENDER_ID, QueryOperators.EQUALS, currentUserId);

    for await (const doc of invitationsQuery.stream()) {
      const invitationDoc = doc as unknown as QueryDocumentSnapshot;
      const invitationUpdates: UpdateData<DocumentData> = {};

      if (usernameChanged) {
        invitationUpdates[InvitationFields.USERNAME] =
          profileUpdates[ProfileFields.USERNAME];
      }
      if (nameChanged) {
        invitationUpdates[InvitationFields.NAME] =
          profileUpdates[ProfileFields.NAME];
      }
      if (avatarChanged) {
        invitationUpdates[InvitationFields.AVATAR] =
          profileUpdates[ProfileFields.AVATAR];
      }

      if (Object.keys(invitationUpdates).length > 0) {
        batch.update(invitationDoc.ref, invitationUpdates);
      }
    }

    // 2. Update friendships where the user is sender
    const friendshipsAsSenderQuery = db
      .collection(Collections.FRIENDSHIPS)
      .where(FriendshipFields.SENDER_ID, QueryOperators.EQUALS, currentUserId);

    for await (const doc of friendshipsAsSenderQuery.stream()) {
      const friendshipDoc = doc as unknown as QueryDocumentSnapshot;
      const friendshipUpdates: UpdateData<DocumentData> = {};

      if (usernameChanged) {
        friendshipUpdates[FriendshipFields.SENDER_USERNAME] =
          profileUpdates[ProfileFields.USERNAME];
      }
      if (nameChanged) {
        friendshipUpdates[FriendshipFields.SENDER_NAME] =
          profileUpdates[ProfileFields.NAME];
      }
      if (avatarChanged) {
        friendshipUpdates[FriendshipFields.SENDER_AVATAR] =
          profileUpdates[ProfileFields.AVATAR];
      }

      if (Object.keys(friendshipUpdates).length > 0) {
        batch.update(friendshipDoc.ref, friendshipUpdates);
      }
    }

    // 3. Update friendships where the user is receiver
    const friendshipsAsReceiverQuery = db
      .collection(Collections.FRIENDSHIPS)
      .where(
        FriendshipFields.RECEIVER_ID,
        QueryOperators.EQUALS,
        currentUserId,
      );

    for await (const doc of friendshipsAsReceiverQuery.stream()) {
      const friendshipDoc = doc as unknown as QueryDocumentSnapshot;
      const friendshipUpdates: UpdateData<DocumentData> = {};

      if (usernameChanged) {
        friendshipUpdates[FriendshipFields.RECEIVER_USERNAME] =
          profileUpdates[ProfileFields.USERNAME];
      }
      if (nameChanged) {
        friendshipUpdates[FriendshipFields.RECEIVER_NAME] =
          profileUpdates[ProfileFields.NAME];
      }
      if (avatarChanged) {
        friendshipUpdates[FriendshipFields.RECEIVER_AVATAR] =
          profileUpdates[ProfileFields.AVATAR];
      }

      if (Object.keys(friendshipUpdates).length > 0) {
        batch.update(friendshipDoc.ref, friendshipUpdates);
      }
    }

    // 4. Update groups where the user is a member
    const groupsQuery = db
      .collection(Collections.GROUPS)
      .where(
        GroupFields.MEMBERS,
        QueryOperators.ARRAY_CONTAINS as WhereFilterOp,
        currentUserId,
      );

    for await (const doc of groupsQuery.stream()) {
      const groupDoc = doc as unknown as QueryDocumentSnapshot;
      const groupData = groupDoc.data();
      const memberProfiles = groupData[GroupFields.MEMBER_PROFILES] || [];

      // Find and update the user's profile in the member_profiles array
      for (let i = 0; i < memberProfiles.length; i++) {
        const memberProfile = memberProfiles[i];
        if (memberProfile[ProfileFields.USER_ID] === currentUserId) {
          const groupMemberSpecificUpdate: UpdateData<DocumentData> = {};

          if (
            usernameChanged &&
            profileUpdates[ProfileFields.USERNAME] !== undefined
          ) {
            groupMemberSpecificUpdate[
              `${GroupFields.MEMBER_PROFILES}.${i}.${ProfileFields.USERNAME}`
              ] = profileUpdates[ProfileFields.USERNAME];
          }
          if (nameChanged && profileUpdates[ProfileFields.NAME] !== undefined) {
            groupMemberSpecificUpdate[
              `${GroupFields.MEMBER_PROFILES}.${i}.${ProfileFields.NAME}`
              ] = profileUpdates[ProfileFields.NAME];
          }
          if (
            avatarChanged &&
            profileUpdates[ProfileFields.AVATAR] !== undefined
          ) {
            groupMemberSpecificUpdate[
              `${GroupFields.MEMBER_PROFILES}.${i}.${ProfileFields.AVATAR}`
              ] = profileUpdates[ProfileFields.AVATAR];
          }

          if (Object.keys(groupMemberSpecificUpdate).length > 0) {
            batch.update(groupDoc.ref, groupMemberSpecificUpdate);
          }
          break;
        }
      }
    }

    // After all reference updates
    logger.info(`Committed batch updates for user ${currentUserId}`);
  }

  // Commit all the updates in a single atomic operation
  if (
    Object.keys(profileUpdates).length > 0 ||
    usernameChanged ||
    nameChanged ||
    avatarChanged
  ) {
    await batch.commit();
  }

  // Get the updated profile data
  const updatedProfileDoc = await profileRef.get();
  const updatedProfileData = updatedProfileDoc.data() || {};

  // Get insights data
  const insightsData = await getProfileInsights(profileRef);

  // Format and return the response
  const response = formatProfileResponse(
    currentUserId,
    updatedProfileData,
    insightsData,
  );

  // Track profile update event
  const event: ProfileEventParams = {
    has_name: !!updatedProfileData[ProfileFields.NAME],
    has_avatar: !!updatedProfileData[ProfileFields.AVATAR],
    has_location: !!updatedProfileData[ProfileFields.LOCATION],
    has_birthday: !!updatedProfileData[ProfileFields.BIRTHDAY],
    has_notification_settings:
      Array.isArray(updatedProfileData[ProfileFields.NOTIFICATION_SETTINGS]) &&
      updatedProfileData[ProfileFields.NOTIFICATION_SETTINGS].length > 0,
    has_gender: !!updatedProfileData[ProfileFields.GENDER],
  };

  return {
    data: response,
    status: 200,
    analytics: {
      event: EventName.PROFILE_UPDATED,
      userId: currentUserId,
      params: event,
    },
  };
};
