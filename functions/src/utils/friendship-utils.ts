import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { Collections } from '../models/constants.js';
import { FriendDoc } from '../models/firestore/friend-doc.js';

/**
 * Friend document result type
 */
type FriendDocumentResult = {
  ref: FirebaseFirestore.DocumentReference;
  doc: FirebaseFirestore.DocumentSnapshot;
  data: FirebaseFirestore.DocumentData;
};

export type FriendDocUpdate = {
  username?: string;
  name?: string;
  avatar?: string;
  last_update_emoji?: string;
  last_update_at?: Timestamp;
  accepter_id?: string;
};

/**
 * Gets a friend document from the current user's FRIENDS subcollection.
 * This function handles migration automatically for both users and never throws for "not found".
 *
 * @param currentUserId - The current user's ID
 * @param targetUserId - The target user's ID (friend)
 * @returns The friend document and data, or null if not found
 */
export const getFriendDoc = async (
  currentUserId: string,
  targetUserId: string,
): Promise<FriendDocumentResult | null> => {
  const db = getFirestore();
  const friendDocRef = db
    .collection(Collections.PROFILES)
    .doc(currentUserId)
    .collection(Collections.FRIENDS)
    .doc(targetUserId);

  const friendDoc = await friendDocRef.get();

  if (!friendDoc.exists) {
    return null;
  }

  return {
    ref: friendDocRef,
    doc: friendDoc,
    data: friendDoc.data() || {},
  };
};

/**
 * Upserts a friend document in /profiles/{uid}/friends/{friendUid}
 */
export const upsertFriendDoc = async (
  db: FirebaseFirestore.Firestore,
  userId: string,
  friendUserId: string,
  data: FriendDocUpdate,
  batch?: FirebaseFirestore.WriteBatch,
): Promise<void> => {
  const friendRef = db.collection(Collections.PROFILES).doc(userId).collection(Collections.FRIENDS).doc(friendUserId);

  const now = Timestamp.now();
  const payload: Partial<FriendDoc> = {};
  if (data.username) payload.username = data.username;
  if (data.name) payload.name = data.name;
  if (data.avatar) payload.avatar = data.avatar;
  if (data.last_update_emoji) payload.last_update_emoji = data.last_update_emoji;
  if (data.last_update_at) payload.last_update_at = data.last_update_at;
  if (data.accepter_id) payload.accepter_id = data.accepter_id;

  if (Object.keys(payload).length === 0) {
    return; // nothing to update
  }

  // always touch updated_at when we have changes
  payload.updated_at = now;

  const write = (b: FirebaseFirestore.WriteBatch) => {
    b.set(friendRef, { created_at: now, ...payload }, { merge: true });
  };

  if (batch) {
    write(batch);
  } else {
    const b = db.batch();
    write(b);
    await b.commit();
  }
};
