import path from 'path';
import { fileURLToPath } from 'url';
import { Collections } from '../models/constants.js';
import { PhoneDoc, phoneConverter } from '../models/firestore/index.js';
import { BaseDAO } from './base-dao.js';
import { getLogger } from '../utils/logging-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Data Access Object for Phone documents with Firestore operations
 * Handles phone-to-user mappings for efficient phone lookup
 */
export class PhoneDAO extends BaseDAO<PhoneDoc> {
  constructor() {
    super(Collections.PHONES, phoneConverter);
  }

  /**
   * Creates a phone-to-user mapping
   * @returns The created phone document
   */
  async create(phone: string, userData: PhoneDoc): Promise<PhoneDoc> {
    const phoneRef = this.getRef(phone);
    await phoneRef.set(userData);

    return userData;
  }

  /**
   * Checks if a phone number exists in the mapping
   */
  async exists(phone: string): Promise<boolean> {
    const phoneRef = this.getRef(phone);
    const phoneDoc = await phoneRef.get();
    return phoneDoc.exists;
  }

  /**
   * Looks up multiple phone numbers in batch
   */
  async getAll(phones: string[]): Promise<PhoneDoc[]> {
    if (phones.length === 0) return [];

    const docRefs = phones.map((phone) => this.getRef(phone));
    const docs = await this.db.getAll(...docRefs);

    return docs.filter((doc) => doc.exists).map((doc) => doc.data()! as PhoneDoc);
  }

  /**
   * Deletes a phone mapping
   */
  async delete(phone: string): Promise<void> {
    await this.db.collection(this.collection).doc(phone).delete();
  }

  /**
   * Updates phone mapping when user's phone changes
   * Handles old phone deletion and new phone creation atomically
   * @returns The new phone document
   */
  async update(oldPhone: string | null, newPhone: string, userData: PhoneDoc): Promise<PhoneDoc> {
    const batch = this.db.batch();

    // Delete old phone mapping if it exists
    if (oldPhone && oldPhone !== newPhone) {
      const oldPhoneRef = this.getRef(oldPhone);
      batch.delete(oldPhoneRef);
    }

    // Create new phone mapping
    const newPhoneRef = this.getRef(newPhone);
    batch.set(newPhoneRef, userData);

    await batch.commit();

    return userData;
  }

  /**
   * Streams all phone mappings for a specific user ID
   * Used for cleanup operations to find orphaned mappings
   */
  async *streamPhonesByUserId(userId: string): AsyncGenerator<{ phoneRef: FirebaseFirestore.DocumentReference }> {
    logger.info(`Streaming phone mappings by user: ${userId}`);

    const query = this.db.collection(this.collection).where('user_id', '==', userId);

    const snapshot = await query.get();
    for (const doc of snapshot.docs) {
      yield { phoneRef: doc.ref };
    }
  }

  /**
   * Deletes a phone mapping by document reference
   * Used for cleanup operations
   */
  async deleteByRef(phoneRef: FirebaseFirestore.DocumentReference): Promise<void> {
    await phoneRef.delete();
    logger.info(`Deleted phone mapping by reference: ${phoneRef.id}`);
  }
}
