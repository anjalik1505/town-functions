import { Timestamp } from 'firebase-admin/firestore';

export interface UserSummaryDoc {
  creator_id: string;
  target_id: string;
  summary: string;
  suggestions: string;
  last_update_id?: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  update_count: number;
}

export const userSummaryConverter: FirebaseFirestore.FirestoreDataConverter<UserSummaryDoc> = {
  toFirestore: (u: UserSummaryDoc) => u,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as UserSummaryDoc,
};

export const usf = <K extends keyof UserSummaryDoc>(k: K) => k;
