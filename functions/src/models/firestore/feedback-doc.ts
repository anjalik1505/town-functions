import { Timestamp } from 'firebase-admin/firestore';

export interface FeedbackDoc {
  created_by: string;
  content: string;
  created_at: Timestamp;
}

export const feedbackConverter: FirebaseFirestore.FirestoreDataConverter<FeedbackDoc> = {
  toFirestore: (f: FeedbackDoc) => f,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as FeedbackDoc,
};

export const fbf = <K extends keyof FeedbackDoc>(k: K) => k;
