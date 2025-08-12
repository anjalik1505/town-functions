import { Timestamp } from 'firebase-admin/firestore';

// Status values for join requests
export const JoinRequestStatus = {
  ACCEPTED: 'accepted',
  PENDING: 'pending',
  REJECTED: 'rejected',
} as const;
export type JoinRequestStatusType = (typeof JoinRequestStatus)[keyof typeof JoinRequestStatus];

export interface JoinRequestDoc {
  invitation_id: string;
  requester_id: string;
  receiver_id: string;
  status: JoinRequestStatusType;
  created_at: Timestamp;
  updated_at: Timestamp;
  requester_name: string;
  requester_username: string;
  requester_avatar: string;
  receiver_name: string;
  receiver_username: string;
  receiver_avatar: string;
}

export const joinRequestConverter: FirebaseFirestore.FirestoreDataConverter<JoinRequestDoc> = {
  toFirestore: (j: JoinRequestDoc) => j,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as JoinRequestDoc,
};

export const jrf = <K extends keyof JoinRequestDoc>(k: K) => k;
