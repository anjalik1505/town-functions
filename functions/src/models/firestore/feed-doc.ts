import { Timestamp } from 'firebase-admin/firestore';

export interface FeedDoc {
  update_id: string;
  created_at: Timestamp;
  created_by: string;
  friend_id: string;
  group_ids: string[];
}

export const feedConverter: FirebaseFirestore.FirestoreDataConverter<FeedDoc> = {
  toFirestore: (f: FeedDoc) => f,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as FeedDoc,
};

export const fdf = <K extends keyof FeedDoc>(k: K) => k;
