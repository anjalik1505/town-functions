import { Timestamp } from 'firebase-admin/firestore';
import { CreatorProfile } from './update-doc.js';

export interface GroupDoc {
  name: string;
  icon: string;
  members: string[];
  member_profiles: Record<string, CreatorProfile>;
  created_at: Timestamp;
}

export const groupConverter: FirebaseFirestore.FirestoreDataConverter<GroupDoc> = {
  toFirestore: (g: GroupDoc) => g,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as GroupDoc,
};

export const gf = <K extends keyof GroupDoc>(k: K) => k;
