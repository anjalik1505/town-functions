import { Timestamp } from 'firebase-admin/firestore';

export interface TimeBucketDoc {
  bucket_hour: string;
  updated_at: Timestamp;
}

export interface TimeBucketUserDoc {
  user_id: string;
  timezone: string;
  nudging_occurrence: string;
  created_at: Timestamp;
}

export const timeBucketConverter: FirebaseFirestore.FirestoreDataConverter<TimeBucketDoc> = {
  toFirestore: (t: TimeBucketDoc) => t,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as TimeBucketDoc,
};

export const timeBucketUserConverter: FirebaseFirestore.FirestoreDataConverter<TimeBucketUserDoc> = {
  toFirestore: (t: TimeBucketUserDoc) => t,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as TimeBucketUserDoc,
};

export const tbf = <K extends keyof TimeBucketDoc>(k: K) => k;
export const tbuf = <K extends keyof TimeBucketUserDoc>(k: K) => k;
