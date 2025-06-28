import { Timestamp } from 'firebase-admin/firestore';

// Context values for friend document creation
export enum FriendDocContext {
  JOIN_REQUEST_ACCEPTED = 'join_request_accepted',
}

export interface FriendDoc {
  username: string;
  name: string;
  avatar: string;
  last_update_emoji: string;
  last_update_at: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
  context?: FriendDocContext;
  accepter_id?: string;
}

export const friendConverter: FirebaseFirestore.FirestoreDataConverter<FriendDoc> = {
  toFirestore: (f: FriendDoc) => f,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as FriendDoc,
};

export const ff = <K extends keyof FriendDoc>(k: K) => k;
