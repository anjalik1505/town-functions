import { Timestamp } from 'firebase-admin/firestore';

export interface ChatAttachment {
  type: string;
  url: string;
  thumbnail: string;
}

export interface ChatDoc {
  sender_id: string;
  text: string;
  created_at: Timestamp;
  attachments: ChatAttachment[];
}

export const chatConverter: FirebaseFirestore.FirestoreDataConverter<ChatDoc> = {
  toFirestore: (c: ChatDoc) => c,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as ChatDoc,
};

export const chf = <K extends keyof ChatDoc>(k: K) => k;
