import { Timestamp } from 'firebase-admin/firestore';

export interface NudgeDoc {
  sender_id: string;
  receiver_id: string;
  timestamp: Timestamp;
}

export const nudgeConverter: FirebaseFirestore.FirestoreDataConverter<NudgeDoc> = {
  toFirestore: (n: NudgeDoc) => n,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as NudgeDoc,
};

export const nf = <K extends keyof NudgeDoc>(k: K) => k;
