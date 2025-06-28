import { DocumentSnapshot, DocumentData } from 'firebase-admin/firestore';
import { BaseDAO } from './base-dao.js';
import { PhoneDoc } from '../models/firestore/phone-doc.js';
import { Collections } from '../models/constants.js';
import { trackApiEvent } from '../utils/analytics-utils.js';
import { EventName } from '../models/analytics-events.js';

/**
 * Data Access Object for Phone documents with Firestore operations
 * Handles phone-to-user mappings for efficient phone lookup
 */
export class PhoneDAO extends BaseDAO<PhoneDoc> {
  constructor() {
    super(Collections.PHONES);
  }

  /**
   * Converts a Firestore document to a PhoneDoc model
   */
  protected documentToModel(doc: DocumentSnapshot): PhoneDoc {
    const data = doc.data();
    if (!data) {
      throw new Error('Phone document data is undefined');
    }

    return {
      user_id: data.user_id || '',
      username: data.username || '',
      name: data.name || '',
      avatar: data.avatar || '',
    };
  }

  /**
   * Converts a PhoneDoc model to Firestore document data
   */
  protected modelToDocument(model: Partial<PhoneDoc>): DocumentData {
    const doc: DocumentData = {};

    if (model.user_id !== undefined) doc.user_id = model.user_id;
    if (model.username !== undefined) doc.username = model.username;
    if (model.name !== undefined) doc.name = model.name;
    if (model.avatar !== undefined) doc.avatar = model.avatar;

    return doc;
  }

  /**
   * Creates a phone-to-user mapping
   */
  async create(phoneNumber: string, userData: Omit<PhoneDoc, 'user_id'> & { user_id: string }): Promise<void> {
    const phoneRef = this.getDocRef(phoneNumber);
    const phoneDoc = {
      ...this.modelToDocument(userData),
    };

    await phoneRef.set(phoneDoc);

    // Track phone mapping creation
    trackApiEvent(EventName.PHONE_MAPPING_CREATED, userData.user_id, {
      phone_number: phoneNumber,
    });
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
   * Gets user data by phone number
   */
  async getByPhone(phoneNumber: string): Promise<PhoneDoc | null> {
    return await this.findById(phoneNumber);
  }

  /**
   * Looks up multiple phone numbers in batch
   */
  async lookupMultiple(phones: string[]): Promise<PhoneDoc[]> {
    if (phones.length === 0) return [];

    const docRefs = phones.map((phone) => this.getDocRef(phone));
    const docs = await this.db.getAll(...docRefs);

    return docs.filter((doc) => doc.exists).map((doc) => this.documentToModel(doc));
  }

  /**
   * Deletes a phone mapping
   */
  async delete(phoneNumber: string): Promise<void> {
    await super.delete(phoneNumber);

    // Track phone mapping deletion
    trackApiEvent(EventName.PHONE_MAPPING_DELETED, 'system', {
      phone_number: phoneNumber,
    });
  }

  /**
   * Updates phone mapping when user's phone changes
   * Handles old phone deletion and new phone creation atomically
   */
  async updateForUser(
    oldPhone: string | null,
    newPhone: string,
    userId: string,
    userData: Omit<PhoneDoc, 'user_id'>,
  ): Promise<void> {
    const batch = this.db.batch();

    // Delete old phone mapping if it exists
    if (oldPhone && oldPhone !== newPhone) {
      const oldPhoneRef = this.getDocRef(oldPhone);
      batch.delete(oldPhoneRef);
    }

    // Create new phone mapping
    const newPhoneRef = this.getDocRef(newPhone);
    const phoneDoc = {
      ...this.modelToDocument({ ...userData, user_id: userId }),
    };
    batch.set(newPhoneRef, phoneDoc);

    await batch.commit();

    // Track phone mapping update
    trackApiEvent(EventName.PHONE_MAPPING_UPDATED, userId, {
      old_phone: oldPhone || '',
      new_phone: newPhone,
    });
  }
}
