import { Timestamp } from 'firebase-admin/firestore';
import { SimpleProfile } from './common.js';

export interface GroupDoc {
  name: string;
  icon: string;
  members: string[];
  member_profiles: Record<string, SimpleProfile>;
  created_at: Timestamp;
}

export const groupConverter: FirebaseFirestore.FirestoreDataConverter<GroupDoc> = {
  toFirestore: (g: GroupDoc) => g,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as GroupDoc,
};

export const gf = <K extends keyof GroupDoc>(k: K) => k;
