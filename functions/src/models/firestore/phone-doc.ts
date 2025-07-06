export interface PhoneDoc {
  user_id: string;
  username: string;
  name: string;
  avatar: string;
}

export const phoneConverter: FirebaseFirestore.FirestoreDataConverter<PhoneDoc> = {
  toFirestore: (p: PhoneDoc) => p,
  fromFirestore: (snap: FirebaseFirestore.QueryDocumentSnapshot) => snap.data() as PhoneDoc,
};

export const phf = <K extends keyof PhoneDoc>(k: K) => k;
