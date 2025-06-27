import { DocumentData, getFirestore, QueryDocumentSnapshot, UpdateData, WhereFilterOp } from 'firebase-admin/firestore';
import { Change, FirestoreEvent } from 'firebase-functions/v2/firestore';
import {
  Collections,
  CommentFields,
  CommentProfileFields,
  CreatorProfileFields,
  GroupFields,
  InvitationFields,
  JoinRequestFields,
  ProfileFields,
  QueryOperators,
  UpdateFields,
} from '../models/constants.js';
import { commitBatch, commitFinal } from '../utils/batch-utils.js';
import { upsertFriendDoc, type FriendDocUpdate } from '../utils/friendship-utils.js';
import { getUserInvitationLink } from '../utils/invitation-utils.js';
import { getLogger } from '../utils/logging-utils.js';

const logger = getLogger('on-profile-update');

/**
 * Handles profile updates and denormalizes user data across related collections.
 * This trigger fires when a profile is updated and updates the user's information
 * in all related documents to maintain data consistency.
 *
 * Note: Phone collection updates are handled in the update-my-profile endpoint
 * because phone number changes require validation to ensure uniqueness.
 */
export const onProfileUpdate = async (
  event: FirestoreEvent<Change<QueryDocumentSnapshot> | undefined, { userId: string }>,
): Promise<void> => {
  if (!event.data) {
    logger.error('No data in profile update event');
    return;
  }

  const { userId } = event.params;
  const before = event.data.before;
  const after = event.data.after;

  if (!before || !after) {
    logger.error('Missing before or after data in profile update');
    return;
  }

  const beforeData = before.data() || {};
  const afterData = after.data() || {};

  // Check if relevant fields changed
  const usernameChanged = beforeData[ProfileFields.USERNAME] !== afterData[ProfileFields.USERNAME];
  const nameChanged = beforeData[ProfileFields.NAME] !== afterData[ProfileFields.NAME];
  const avatarChanged = beforeData[ProfileFields.AVATAR] !== afterData[ProfileFields.AVATAR];
  const phoneChanged = beforeData[ProfileFields.PHONE_NUMBER] !== afterData[ProfileFields.PHONE_NUMBER];

  if (!usernameChanged && !nameChanged && !avatarChanged && !phoneChanged) {
    logger.info(`No relevant profile changes for user ${userId}`);
    return;
  }

  logger.info(`Profile update detected for user ${userId}:`, {
    usernameChanged,
    nameChanged,
    avatarChanged,
    phoneChanged,
  });

  const db = getFirestore();

  try {
    // Create a batch for all updates
    let batch = db.batch();
    let batchCount = 0;

    // 1. Update phones collection mapping
    if (phoneChanged) {
      const oldPhone = beforeData[ProfileFields.PHONE_NUMBER] as string | undefined;
      const newPhone = afterData[ProfileFields.PHONE_NUMBER] as string | undefined;

      // Delete old mapping if it existed
      if (oldPhone) {
        const oldPhoneRef = db.collection(Collections.PHONES).doc(oldPhone);
        batch.delete(oldPhoneRef);
        batchCount++;

        // Commit batch if approaching limit
        ({ batch, batchCount } = await commitBatch(db, batch, batchCount));
      }

      // Create new mapping if new phone exists
      if (newPhone) {
        const newPhoneRef = db.collection(Collections.PHONES).doc(newPhone);
        batch.set(newPhoneRef, {
          [ProfileFields.USER_ID]: userId,
          [ProfileFields.USERNAME]: afterData[ProfileFields.USERNAME],
          [ProfileFields.NAME]: afterData[ProfileFields.NAME],
          [ProfileFields.AVATAR]: afterData[ProfileFields.AVATAR],
        });
        batchCount++;

        // Commit batch if approaching limit
        ({ batch, batchCount } = await commitBatch(db, batch, batchCount));
      }
    } else if ((usernameChanged || nameChanged || avatarChanged) && afterData[ProfileFields.PHONE_NUMBER]) {
      // Phone hasn't changed but user info did; update mapping doc
      const phone = afterData[ProfileFields.PHONE_NUMBER] as string;
      const phoneRef = db.collection(Collections.PHONES).doc(phone);
      const updates: UpdateData<DocumentData> = {};
      if (usernameChanged) updates[ProfileFields.USERNAME] = afterData[ProfileFields.USERNAME];
      if (nameChanged) updates[ProfileFields.NAME] = afterData[ProfileFields.NAME];
      if (avatarChanged) updates[ProfileFields.AVATAR] = afterData[ProfileFields.AVATAR];
      batch.update(phoneRef, updates);
      batchCount++;

      // Commit batch if approaching limit
      ({ batch, batchCount } = await commitBatch(db, batch, batchCount));
    }

    // Only proceed with other updates if username, name, or avatar changed
    if (usernameChanged || nameChanged || avatarChanged) {
      // 2. Update the user's invitation if it exists
      const existingInvitation = await getUserInvitationLink(userId);
      if (existingInvitation) {
        const invitationRef = existingInvitation.ref;
        const invitationUpdates: UpdateData<DocumentData> = {};

        if (usernameChanged) {
          invitationUpdates[InvitationFields.USERNAME] = afterData[ProfileFields.USERNAME];
        }
        if (nameChanged) {
          invitationUpdates[InvitationFields.NAME] = afterData[ProfileFields.NAME];
        }
        if (avatarChanged) {
          invitationUpdates[InvitationFields.AVATAR] = afterData[ProfileFields.AVATAR];
        }

        if (Object.keys(invitationUpdates).length > 0) {
          batch.update(invitationRef, invitationUpdates);
          batchCount++;

          // Commit batch if approaching limit
          ({ batch, batchCount } = await commitBatch(db, batch, batchCount));

          // Update join requests where the user is the receiver (invitation owner)
          const joinRequestsQuery = invitationRef
            .collection(Collections.JOIN_REQUESTS)
            .orderBy(JoinRequestFields.CREATED_AT, QueryOperators.DESC);

          for await (const doc of joinRequestsQuery.stream()) {
            const joinRequestDoc = doc as unknown as QueryDocumentSnapshot;
            const joinRequestUpdates: UpdateData<DocumentData> = {};

            if (usernameChanged) {
              joinRequestUpdates[JoinRequestFields.RECEIVER_USERNAME] = afterData[ProfileFields.USERNAME];
            }
            if (nameChanged) {
              joinRequestUpdates[JoinRequestFields.RECEIVER_NAME] = afterData[ProfileFields.NAME];
            }
            if (avatarChanged) {
              joinRequestUpdates[JoinRequestFields.RECEIVER_AVATAR] = afterData[ProfileFields.AVATAR];
            }

            if (Object.keys(joinRequestUpdates).length > 0) {
              batch.update(joinRequestDoc.ref, joinRequestUpdates);
              batchCount++;

              // Commit batch if approaching limit
              ({ batch, batchCount } = await commitBatch(db, batch, batchCount));
            }
          }
        }
      }

      // 3. Update join requests where the user is the requester
      const requesterJoinRequestsQuery = db
        .collectionGroup(Collections.JOIN_REQUESTS)
        .where(JoinRequestFields.REQUESTER_ID, QueryOperators.EQUALS, userId)
        .orderBy(JoinRequestFields.CREATED_AT, QueryOperators.DESC);

      for await (const doc of requesterJoinRequestsQuery.stream()) {
        const joinRequestDoc = doc as unknown as QueryDocumentSnapshot;
        const joinRequestUpdates: UpdateData<DocumentData> = {};

        if (usernameChanged) {
          joinRequestUpdates[JoinRequestFields.REQUESTER_USERNAME] = afterData[ProfileFields.USERNAME];
        }
        if (nameChanged) {
          joinRequestUpdates[JoinRequestFields.REQUESTER_NAME] = afterData[ProfileFields.NAME];
        }
        if (avatarChanged) {
          joinRequestUpdates[JoinRequestFields.REQUESTER_AVATAR] = afterData[ProfileFields.AVATAR];
        }

        if (Object.keys(joinRequestUpdates).length > 0) {
          batch.update(joinRequestDoc.ref, joinRequestUpdates);
          batchCount++;

          // Commit batch if approaching limit
          ({ batch, batchCount } = await commitBatch(db, batch, batchCount));
        }
      }

      // 4. Update friend documents in FRIENDS subcollections
      logger.info('Updating friend documents in FRIENDS subcollections');

      // Get list of friends from user's FRIENDS subcollection
      const userFriendsQuery = db.collection(Collections.PROFILES).doc(userId).collection(Collections.FRIENDS);

      const friendIds: string[] = [];
      for await (const doc of userFriendsQuery.stream()) {
        const friendDoc = doc as unknown as QueryDocumentSnapshot;
        friendIds.push(friendDoc.id);
      }

      // Update this user's data in each friend's FRIENDS subcollection
      for (const friendId of friendIds) {
        const friendDocUpdate: FriendDocUpdate = {};

        if (usernameChanged) {
          friendDocUpdate.username = afterData[ProfileFields.USERNAME] as string;
        }
        if (nameChanged) {
          friendDocUpdate.name = afterData[ProfileFields.NAME] as string;
        }
        if (avatarChanged) {
          friendDocUpdate.avatar = afterData[ProfileFields.AVATAR] as string;
        }

        // Note: upsertFriendDoc performs a batch.set operation internally
        await upsertFriendDoc(db, friendId, userId, friendDocUpdate, batch);
        batchCount++;

        // Commit batch if approaching limit
        ({ batch, batchCount } = await commitBatch(db, batch, batchCount));
      }

      // 5. Update groups where the user is a member
      const groupsQuery = db
        .collection(Collections.GROUPS)
        .where(GroupFields.MEMBERS, QueryOperators.ARRAY_CONTAINS as WhereFilterOp, userId);

      for await (const doc of groupsQuery.stream()) {
        const groupDoc = doc as unknown as QueryDocumentSnapshot;
        const groupData = groupDoc.data();
        const memberProfiles = groupData[GroupFields.MEMBER_PROFILES] || [];

        // Find and update the user's profile in the member_profiles array
        for (let i = 0; i < memberProfiles.length; i++) {
          const memberProfile = memberProfiles[i];
          if (memberProfile[ProfileFields.USER_ID] === userId) {
            const groupMemberSpecificUpdate: UpdateData<DocumentData> = {};

            if (usernameChanged && afterData[ProfileFields.USERNAME] !== undefined) {
              groupMemberSpecificUpdate[`${GroupFields.MEMBER_PROFILES}.${i}.${ProfileFields.USERNAME}`] =
                afterData[ProfileFields.USERNAME];
            }
            if (nameChanged && afterData[ProfileFields.NAME] !== undefined) {
              groupMemberSpecificUpdate[`${GroupFields.MEMBER_PROFILES}.${i}.${ProfileFields.NAME}`] =
                afterData[ProfileFields.NAME];
            }
            if (avatarChanged && afterData[ProfileFields.AVATAR] !== undefined) {
              groupMemberSpecificUpdate[`${GroupFields.MEMBER_PROFILES}.${i}.${ProfileFields.AVATAR}`] =
                afterData[ProfileFields.AVATAR];
            }

            if (Object.keys(groupMemberSpecificUpdate).length > 0) {
              batch.update(groupDoc.ref, groupMemberSpecificUpdate);
              batchCount++;

              // Commit batch if approaching limit
              ({ batch, batchCount } = await commitBatch(db, batch, batchCount));
            }
            break;
          }
        }
      }

      // 6. Update creator_profile in all updates created by the user
      logger.info('Updating creator profiles in updates');
      const creatorUpdatesQuery = db
        .collection(Collections.UPDATES)
        .where(UpdateFields.CREATED_BY, QueryOperators.EQUALS, userId);

      for await (const doc of creatorUpdatesQuery.stream()) {
        const updateDoc = doc as unknown as QueryDocumentSnapshot;
        const creatorProfileUpdates: UpdateData<DocumentData> = {};

        if (usernameChanged) {
          creatorProfileUpdates[`${UpdateFields.CREATOR_PROFILE}.${CreatorProfileFields.USERNAME}`] =
            afterData[ProfileFields.USERNAME];
        }
        if (nameChanged) {
          creatorProfileUpdates[`${UpdateFields.CREATOR_PROFILE}.${CreatorProfileFields.NAME}`] =
            afterData[ProfileFields.NAME];
        }
        if (avatarChanged) {
          creatorProfileUpdates[`${UpdateFields.CREATOR_PROFILE}.${CreatorProfileFields.AVATAR}`] =
            afterData[ProfileFields.AVATAR];
        }

        if (Object.keys(creatorProfileUpdates).length > 0) {
          batch.update(updateDoc.ref, creatorProfileUpdates);
          batchCount++;

          // Commit batch if approaching limit
          ({ batch, batchCount } = await commitBatch(db, batch, batchCount));
        }
      }

      // 7. Update shared_with_friends_profiles in updates where user appears
      logger.info('Updating shared with friends profiles in updates');
      const sharedUpdatesQuery = db
        .collection(Collections.UPDATES)
        .where(UpdateFields.FRIEND_IDS, QueryOperators.ARRAY_CONTAINS as WhereFilterOp, userId);

      for await (const doc of sharedUpdatesQuery.stream()) {
        const updateDoc = doc as unknown as QueryDocumentSnapshot;
        const updateData = updateDoc.data();
        const sharedWithFriendsProfiles = updateData[UpdateFields.SHARED_WITH_FRIENDS_PROFILES] || [];

        // Find and update the user's profile in the shared_with_friends_profiles array
        for (let i = 0; i < sharedWithFriendsProfiles.length; i++) {
          const friendProfile = sharedWithFriendsProfiles[i];
          if (friendProfile[ProfileFields.USER_ID] === userId) {
            const sharedProfileUpdates: UpdateData<DocumentData> = {};

            if (usernameChanged) {
              sharedProfileUpdates[`${UpdateFields.SHARED_WITH_FRIENDS_PROFILES}.${i}.${ProfileFields.USERNAME}`] =
                afterData[ProfileFields.USERNAME];
            }
            if (nameChanged) {
              sharedProfileUpdates[`${UpdateFields.SHARED_WITH_FRIENDS_PROFILES}.${i}.${ProfileFields.NAME}`] =
                afterData[ProfileFields.NAME];
            }
            if (avatarChanged) {
              sharedProfileUpdates[`${UpdateFields.SHARED_WITH_FRIENDS_PROFILES}.${i}.${ProfileFields.AVATAR}`] =
                afterData[ProfileFields.AVATAR];
            }

            if (Object.keys(sharedProfileUpdates).length > 0) {
              batch.update(updateDoc.ref, sharedProfileUpdates);
              batchCount++;

              // Commit batch if approaching limit
              ({ batch, batchCount } = await commitBatch(db, batch, batchCount));
            }
            break;
          }
        }
      }

      // 8. Update commenter_profile in all comments created by the user
      logger.info('Updating commenter profiles in comments');
      const commentsQuery = db
        .collectionGroup(Collections.COMMENTS)
        .where(CommentFields.CREATED_BY, QueryOperators.EQUALS, userId);

      for await (const doc of commentsQuery.stream()) {
        const commentDoc = doc as unknown as QueryDocumentSnapshot;
        const commenterProfileUpdates: UpdateData<DocumentData> = {};

        if (usernameChanged) {
          commenterProfileUpdates[`${CommentFields.COMMENTER_PROFILE}.${CommentProfileFields.USERNAME}`] =
            afterData[ProfileFields.USERNAME];
        }
        if (nameChanged) {
          commenterProfileUpdates[`${CommentFields.COMMENTER_PROFILE}.${CommentProfileFields.NAME}`] =
            afterData[ProfileFields.NAME];
        }
        if (avatarChanged) {
          commenterProfileUpdates[`${CommentFields.COMMENTER_PROFILE}.${CommentProfileFields.AVATAR}`] =
            afterData[ProfileFields.AVATAR];
        }

        if (Object.keys(commenterProfileUpdates).length > 0) {
          batch.update(commentDoc.ref, commenterProfileUpdates);
          batchCount++;

          // Commit batch if approaching limit
          ({ batch, batchCount } = await commitBatch(db, batch, batchCount));
        }
      }
    }

    // Commit all remaining updates in a single atomic operation
    await commitFinal(db, batch, batchCount);
    logger.info(`Successfully updated denormalized data for user ${userId}`);
  } catch (error) {
    logger.error(`Error updating denormalized data for user ${userId}:`, error);
    throw error;
  }
};
