import { QueryDocumentSnapshot, WhereFilterOp, getFirestore } from 'firebase-admin/firestore';
import { Change, FirestoreEvent } from 'firebase-functions/v2/firestore';
import { Collections, QueryOperators } from '../models/constants.js';
import { commitBatch, commitFinal } from '../utils/batch-utils.js';
import { upsertFriendDoc, type FriendDocUpdate } from '../utils/friendship-utils.js';
import { getUserInvitationLink } from '../utils/invitation-utils.js';
import { getLogger } from '../utils/logging-utils.js';

// Import typed converters and field selectors
import { CommentDoc, cf, commentConverter } from '../models/firestore/comment-doc.js';
import { FriendDoc, friendConverter } from '../models/firestore/friend-doc.js';
import { GroupDoc, gf, groupConverter } from '../models/firestore/group-doc.js';
import { InvitationDoc, if_, invitationConverter } from '../models/firestore/invitation-doc.js';
import { JoinRequestDoc, joinRequestConverter, jrf } from '../models/firestore/join-request-doc.js';
import { ProfileDoc, pf } from '../models/firestore/profile-doc.js';
import { CreatorProfile, UpdateDoc, UserProfile, uf, updateConverter } from '../models/firestore/update-doc.js';

const logger = getLogger('on-profile-update');

// Define PhoneDoc interface (since it's not in a separate file)
interface PhoneDoc {
  user_id: string;
  username: string;
  name: string;
  avatar: string;
}

const phoneConverter: FirebaseFirestore.FirestoreDataConverter<PhoneDoc> = {
  toFirestore: (p) => p,
  fromFirestore: (snap) => snap.data() as PhoneDoc,
};

const phf = <K extends keyof PhoneDoc>(k: K) => k;

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

  // Convert the snapshots to typed documents
  const beforeData = before.data() as ProfileDoc;
  const afterData = after.data() as ProfileDoc;

  if (!beforeData || !afterData) {
    logger.error('Missing data in profile documents');
    return;
  }

  // Check if relevant fields changed
  const usernameChanged = beforeData[pf('username')] !== afterData[pf('username')];
  const nameChanged = beforeData[pf('name')] !== afterData[pf('name')];
  const avatarChanged = beforeData[pf('avatar')] !== afterData[pf('avatar')];
  const phoneChanged = beforeData[pf('phone_number')] !== afterData[pf('phone_number')];

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
      const oldPhone = beforeData[pf('phone_number')];
      const newPhone = afterData[pf('phone_number')];

      // Delete old mapping if it existed
      if (oldPhone) {
        const oldPhoneRef = db.collection(Collections.PHONES).doc(oldPhone).withConverter(phoneConverter);
        batch.delete(oldPhoneRef);
        batchCount++;

        // Commit batch if approaching limit
        ({ batch, batchCount } = await commitBatch(db, batch, batchCount));
      }

      // Create new mapping if new phone exists
      if (newPhone) {
        const newPhoneRef = db.collection(Collections.PHONES).doc(newPhone).withConverter(phoneConverter);
        const phoneData: PhoneDoc = {
          [phf('user_id')]: userId,
          [phf('username')]: afterData[pf('username')],
          [phf('name')]: afterData[pf('name')],
          [phf('avatar')]: afterData[pf('avatar')],
        };
        batch.set(newPhoneRef, phoneData);
        batchCount++;

        // Commit batch if approaching limit
        ({ batch, batchCount } = await commitBatch(db, batch, batchCount));
      }
    } else if ((usernameChanged || nameChanged || avatarChanged) && afterData[pf('phone_number')]) {
      // Phone hasn't changed but user info did; update mapping doc
      const phone = afterData[pf('phone_number')];
      const phoneRef = db.collection(Collections.PHONES).doc(phone).withConverter(phoneConverter);
      const updates: Partial<PhoneDoc> = {};
      if (usernameChanged) updates[phf('username')] = afterData[pf('username')];
      if (nameChanged) updates[phf('name')] = afterData[pf('name')];
      if (avatarChanged) updates[phf('avatar')] = afterData[pf('avatar')];
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
        const invitationRef = existingInvitation.ref.withConverter(invitationConverter);
        const invitationUpdates: Partial<InvitationDoc> = {};

        if (usernameChanged) {
          invitationUpdates[if_('username')] = afterData[pf('username')];
        }
        if (nameChanged) {
          invitationUpdates[if_('name')] = afterData[pf('name')];
        }
        if (avatarChanged) {
          invitationUpdates[if_('avatar')] = afterData[pf('avatar')];
        }

        if (Object.keys(invitationUpdates).length > 0) {
          batch.update(invitationRef, invitationUpdates);
          batchCount++;

          // Commit batch if approaching limit
          ({ batch, batchCount } = await commitBatch(db, batch, batchCount));

          // Update join requests where the user is the receiver (invitation owner)
          const joinRequestsQuery = invitationRef
            .collection(Collections.JOIN_REQUESTS)
            .withConverter(joinRequestConverter)
            .orderBy(jrf('created_at'), QueryOperators.DESC);

          for await (const doc of joinRequestsQuery.stream()) {
            const joinRequestDoc = doc as unknown as QueryDocumentSnapshot<JoinRequestDoc>;
            const joinRequestUpdates: Partial<JoinRequestDoc> = {};

            if (usernameChanged) {
              joinRequestUpdates[jrf('receiver_username')] = afterData[pf('username')];
            }
            if (nameChanged) {
              joinRequestUpdates[jrf('receiver_name')] = afterData[pf('name')];
            }
            if (avatarChanged) {
              joinRequestUpdates[jrf('receiver_avatar')] = afterData[pf('avatar')];
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
        .where(jrf('requester_id'), QueryOperators.EQUALS, userId)
        .orderBy(jrf('created_at'), QueryOperators.DESC);

      for await (const doc of requesterJoinRequestsQuery.stream()) {
        const joinRequestDoc = doc as unknown as QueryDocumentSnapshot;
        const joinRequestRef = joinRequestDoc.ref.withConverter(joinRequestConverter);
        const joinRequestUpdates: Partial<JoinRequestDoc> = {};

        if (usernameChanged) {
          joinRequestUpdates[jrf('requester_username')] = afterData[pf('username')];
        }
        if (nameChanged) {
          joinRequestUpdates[jrf('requester_name')] = afterData[pf('name')];
        }
        if (avatarChanged) {
          joinRequestUpdates[jrf('requester_avatar')] = afterData[pf('avatar')];
        }

        if (Object.keys(joinRequestUpdates).length > 0) {
          batch.update(joinRequestRef, joinRequestUpdates);
          batchCount++;

          // Commit batch if approaching limit
          ({ batch, batchCount } = await commitBatch(db, batch, batchCount));
        }
      }

      // 4. Update friend documents in FRIENDS subcollections
      logger.info('Updating friend documents in FRIENDS subcollections');

      // Get list of friends from user's FRIENDS subcollection
      const userFriendsQuery = db
        .collection(Collections.PROFILES)
        .doc(userId)
        .collection(Collections.FRIENDS)
        .withConverter(friendConverter);

      const friendIds: string[] = [];
      for await (const doc of userFriendsQuery.stream()) {
        const friendDoc = doc as unknown as QueryDocumentSnapshot<FriendDoc>;
        friendIds.push(friendDoc.id);
      }

      // Update this user's data in each friend's FRIENDS subcollection
      for (const friendId of friendIds) {
        const friendDocUpdate: FriendDocUpdate = {};

        if (usernameChanged) {
          friendDocUpdate.username = afterData[pf('username')];
        }
        if (nameChanged) {
          friendDocUpdate.name = afterData[pf('name')];
        }
        if (avatarChanged) {
          friendDocUpdate.avatar = afterData[pf('avatar')];
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
        .where(gf('members'), QueryOperators.ARRAY_CONTAINS as WhereFilterOp, userId);

      for await (const doc of groupsQuery.stream()) {
        const groupDoc = doc as unknown as QueryDocumentSnapshot;
        const groupRef = groupDoc.ref.withConverter(groupConverter);
        const groupData = groupDoc.data() as GroupDoc;
        const memberProfiles = groupData[gf('member_profiles')] || {};

        // Update the user's profile in the member_profiles map
        if (memberProfiles[userId]) {
          const memberProfileUpdate: Partial<GroupDoc> = {};
          const updatedProfile: CreatorProfile = { ...memberProfiles[userId] };

          if (usernameChanged) {
            updatedProfile.username = afterData[pf('username')];
          }
          if (nameChanged) {
            updatedProfile.name = afterData[pf('name')];
          }
          if (avatarChanged) {
            updatedProfile.avatar = afterData[pf('avatar')];
          }

          // Use direct property access instead of computed property for type safety
          const memberProfilesKey = gf('member_profiles');
          memberProfileUpdate[memberProfilesKey] = {
            ...memberProfiles,
            [userId]: updatedProfile,
          };

          batch.update(groupRef, memberProfileUpdate);
          batchCount++;

          // Commit batch if approaching limit
          ({ batch, batchCount } = await commitBatch(db, batch, batchCount));
        }
      }

      // 6. Update creator_profile in all updates created by the user
      logger.info('Updating creator profiles in updates');
      const creatorUpdatesQuery = db
        .collection(Collections.UPDATES)
        .where(uf('created_by'), QueryOperators.EQUALS, userId);

      for await (const doc of creatorUpdatesQuery.stream()) {
        const updateDoc = doc as unknown as QueryDocumentSnapshot;
        const updateRef = updateDoc.ref.withConverter(updateConverter);
        const creatorProfileUpdates: Partial<UpdateDoc> = {};

        // Build the nested update path for creator_profile
        const creatorProfile: CreatorProfile = {
          username: afterData[pf('username')],
          name: afterData[pf('name')],
          avatar: afterData[pf('avatar')],
        };

        creatorProfileUpdates[uf('creator_profile')] = creatorProfile;

        batch.update(updateRef, creatorProfileUpdates);
        batchCount++;

        // Commit batch if approaching limit
        ({ batch, batchCount } = await commitBatch(db, batch, batchCount));
      }

      // 7. Update shared_with_friends_profiles in updates where user appears
      logger.info('Updating shared with friends profiles in updates');
      const sharedUpdatesQuery = db
        .collection(Collections.UPDATES)
        .where(uf('friend_ids'), QueryOperators.ARRAY_CONTAINS as WhereFilterOp, userId);

      for await (const doc of sharedUpdatesQuery.stream()) {
        const updateDoc = doc as unknown as QueryDocumentSnapshot;
        const updateRef = updateDoc.ref.withConverter(updateConverter);
        const updateData = updateDoc.data() as UpdateDoc;
        const sharedWithFriendsProfiles = updateData[uf('shared_with_friends_profiles')] || [];

        // Find and update the user's profile in the shared_with_friends_profiles array
        const userProfileIndex = sharedWithFriendsProfiles.findIndex((profile) => profile.user_id === userId);

        if (userProfileIndex !== -1) {
          const sharedProfileUpdate: Partial<UpdateDoc> = {};
          const updatedProfiles = [...sharedWithFriendsProfiles];
          const existingProfile = updatedProfiles[userProfileIndex]!;
          const updatedProfile: UserProfile = {
            user_id: existingProfile.user_id,
            username: existingProfile.username,
            name: existingProfile.name,
            avatar: existingProfile.avatar,
          };

          if (usernameChanged) {
            updatedProfile.username = afterData[pf('username')];
          }
          if (nameChanged) {
            updatedProfile.name = afterData[pf('name')];
          }
          if (avatarChanged) {
            updatedProfile.avatar = afterData[pf('avatar')];
          }

          updatedProfiles[userProfileIndex] = updatedProfile;

          // Use direct property access instead of computed property for type safety
          const sharedProfilesKey = uf('shared_with_friends_profiles');
          sharedProfileUpdate[sharedProfilesKey] = updatedProfiles;

          batch.update(updateRef, sharedProfileUpdate);
          batchCount++;

          // Commit batch if approaching limit
          ({ batch, batchCount } = await commitBatch(db, batch, batchCount));
        }
      }

      // 8. Update commenter_profile in all comments created by the user
      logger.info('Updating commenter profiles in comments');
      const commentsQuery = db
        .collectionGroup(Collections.COMMENTS)
        .where(cf('created_by'), QueryOperators.EQUALS, userId);

      for await (const doc of commentsQuery.stream()) {
        const commentDoc = doc as unknown as QueryDocumentSnapshot;
        const commentRef = commentDoc.ref.withConverter(commentConverter);
        const commenterProfileUpdates: Partial<CommentDoc> = {};

        // Build the commenter profile
        const commenterProfile: CreatorProfile = {
          username: afterData[pf('username')],
          name: afterData[pf('name')],
          avatar: afterData[pf('avatar')],
        };

        commenterProfileUpdates[cf('commenter_profile')] = commenterProfile;

        batch.update(commentRef, commenterProfileUpdates);
        batchCount++;

        // Commit batch if approaching limit
        ({ batch, batchCount } = await commitBatch(db, batch, batchCount));
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
