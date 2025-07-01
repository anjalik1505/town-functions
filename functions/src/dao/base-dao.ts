import { getFirestore } from 'firebase-admin/firestore';

export abstract class BaseDAO<T, S = T> {
  protected collection: string;
  protected subcollection?: string;
  protected db: FirebaseFirestore.Firestore;
  protected converter: FirebaseFirestore.FirestoreDataConverter<T>;
  protected subconverter?: FirebaseFirestore.FirestoreDataConverter<S>;

  constructor(
    collectionName: string,
    converter: FirebaseFirestore.FirestoreDataConverter<T>,
    subcollectionName?: string,
    subconverter?: FirebaseFirestore.FirestoreDataConverter<S>,
  ) {
    this.collection = collectionName;
    this.subcollection = subcollectionName;
    this.db = getFirestore();
    this.converter = converter;
    this.subconverter = subconverter;
  }

  async findById(id: string): Promise<T | null> {
    const doc = await this.db.collection(this.collection).withConverter(this.converter).doc(id).get();
    return doc.exists ? (doc.data() ?? null) : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.collection(this.collection).doc(id).delete();
  }

  protected getDocRef(id: string): FirebaseFirestore.DocumentReference<T> {
    return this.db.collection(this.collection).withConverter(this.converter).doc(id);
  }
}
