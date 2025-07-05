import { Timestamp } from 'firebase-admin/firestore';
import { SimpleProfile } from './common.js';

export interface CommentDoc {
  id: string;
  created_by: string;
  content: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  parent_id: string | null;
  commenter_profile: SimpleProfile;
}

export const commentConverter: FirebaseFirestore.FirestoreDataConverter<CommentDoc> = {
  toFirestore: (c: CommentDoc) => c,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as CommentDoc,
};

export const cf = <K extends keyof CommentDoc>(k: K) => k;
