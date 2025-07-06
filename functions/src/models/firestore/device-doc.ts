import { Timestamp } from 'firebase-admin/firestore';

export interface DeviceDoc {
  device_id: string;
  updated_at: Timestamp;
}

export const deviceConverter: FirebaseFirestore.FirestoreDataConverter<DeviceDoc> = {
  toFirestore: (d: DeviceDoc) => d,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as DeviceDoc,
};

export const df = <K extends keyof DeviceDoc>(k: K) => k;
