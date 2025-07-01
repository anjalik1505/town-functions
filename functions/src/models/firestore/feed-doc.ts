import { Timestamp } from 'firebase-admin/firestore';

export interface FeedDoc {
  update_id: string;
  created_at: Timestamp;
  direct_visible: boolean;
  friend_id: string;
  group_ids: string[];
  created_by: string;
}

export const feedConverter: FirebaseFirestore.FirestoreDataConverter<FeedDoc> = {
  toFirestore: (f: FeedDoc) => f,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as FeedDoc,
};

export const fdf = <K extends keyof FeedDoc>(k: K) => k;
