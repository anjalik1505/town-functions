import { Timestamp } from 'firebase-admin/firestore';

export interface InvitationDoc {
  created_at: Timestamp;
  sender_id: string;
  username: string;
  name: string;
  avatar: string;
}

export const invitationConverter: FirebaseFirestore.FirestoreDataConverter<InvitationDoc> = {
  toFirestore: (i: InvitationDoc) => i,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as InvitationDoc,
};

export const if_ = <K extends keyof InvitationDoc>(k: K) => k;
