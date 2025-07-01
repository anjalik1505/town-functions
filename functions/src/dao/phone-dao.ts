import { Collections } from '../models/constants.js';
import { PhoneDoc, phoneConverter } from '../models/firestore/phone-doc.js';
import { BaseDAO } from './base-dao.js';

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
  async create(phoneNumber: string, userData: PhoneDoc): Promise<PhoneDoc> {
    const phoneRef = this.getDocRef(phoneNumber);
    await phoneRef.set(userData);

    return userData;
  }

  /**
   * Checks if a phone number exists in the mapping
   */
  async exists(phoneNumber: string): Promise<boolean> {
    const phoneRef = this.getDocRef(phoneNumber);
    const phoneDoc = await phoneRef.get();
    return phoneDoc.exists;
  }

  /**
   * Looks up multiple phone numbers in batch
   */
  async lookupMultiple(phones: string[]): Promise<PhoneDoc[]> {
    if (phones.length === 0) return [];

    const docRefs = phones.map((phone) => this.getDocRef(phone));
    const docs = await this.db.getAll(...docRefs);

    return docs.filter((doc) => doc.exists).map((doc) => doc.data()! as PhoneDoc);
  }

  /**
   * Deletes a phone mapping
   */
  async delete(phoneNumber: string): Promise<void> {
    await super.delete(phoneNumber);
  }

  /**
   * Updates phone mapping when user's phone changes
   * Handles old phone deletion and new phone creation atomically
   * @returns The new phone document
   */
  async updateForUser(oldPhone: string | null, newPhone: string, userData: PhoneDoc): Promise<PhoneDoc> {
    const batch = this.db.batch();

    // Delete old phone mapping if it exists
    if (oldPhone && oldPhone !== newPhone) {
      const oldPhoneRef = this.getDocRef(oldPhone);
      batch.delete(oldPhoneRef);
    }

    // Create new phone mapping
    const newPhoneRef = this.getDocRef(newPhone);
    batch.set(newPhoneRef, userData);

    await batch.commit();

    return userData;
  }
}
