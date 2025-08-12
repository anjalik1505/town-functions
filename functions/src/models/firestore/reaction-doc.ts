import { Timestamp } from 'firebase-admin/firestore';

export interface ReactionDoc {
  types: string[];
  created_at: Timestamp;
  updated_at: Timestamp;
}

export const reactionConverter: FirebaseFirestore.FirestoreDataConverter<ReactionDoc> = {
  toFirestore: (r: ReactionDoc) => r,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as ReactionDoc,
};

export const rf = <K extends keyof ReactionDoc>(k: K) => k;
