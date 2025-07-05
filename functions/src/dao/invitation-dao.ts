import { DocumentReference, Timestamp } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { Collections, QueryOperators } from '../models/constants.js';
import { InvitationDoc, if_, invitationConverter } from '../models/firestore/index.js';
import { CreatorProfile } from '../models/firestore/update-doc.js';
import { getLogger } from '../utils/logging-utils.js';
import { BaseDAO } from './base-dao.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Data Access Object for Invitation documents
 * Manages invitations with sender profile denormalization
 */
export class InvitationDAO extends BaseDAO<InvitationDoc> {
  constructor() {
    super(Collections.INVITATIONS, invitationConverter, Collections.JOIN_REQUESTS);
  }

  /**
   * Gets an invitation by the sender's user ID
   * @param userId The user ID to find the invitation for
   * @returns The invitation document with ID, or null if not found
   */
  async getByUser(userId: string): Promise<{ id: string; ref: DocumentReference; data: InvitationDoc } | null> {
    const query = this.db
      .collection(this.collection)
      .withConverter(this.converter)
      .where(if_('sender_id'), QueryOperators.EQUALS, userId)
      .limit(1);

    const snapshot = await query.get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0]!;
    return {
      id: doc.id,
      ref: doc.ref,
      data: doc.data()!,
    };
  }

  /**
   * Gets an invitation by its ID
   * @param invitationId The invitation ID to find
   * @returns The invitation document, or null if not found
   */
  async getByInvitationId(invitationId: string): Promise<InvitationDoc | null> {
    const ref = this.getRef(invitationId);
    const doc = await ref.get();
    if (!doc.exists) {
      return null;
    }
    return doc.data()!;
  }

  /**
   * Creates an invitation or returns the existing one
   * @param userId The user ID creating the invitation
   * @param profileData The user's profile data to denormalize
   * @returns The invitation ID and data
   */
  async createOrGet(
    userId: string,
    profileData: { username: string; name: string; avatar: string },
  ): Promise<{ id: string; data: InvitationDoc }> {
    // Check if invitation already exists
    const existing = await this.getByUser(userId);
    if (existing) {
      return existing;
    }

    // Create new invitation
    const invitationData: InvitationDoc = {
      created_at: Timestamp.now(),
      sender_id: userId,
      username: profileData.username,
      name: profileData.name,
      avatar: profileData.avatar,
    };

    const invitationRef = this.db.collection(this.collection).withConverter(this.converter).doc();
    await invitationRef.set(invitationData);

    return {
      id: invitationRef.id,
      data: invitationData,
    };
  }

  /**
   * Deletes an invitation by ID
   * @param invitationId The invitation ID to delete
   */
  async delete(invitationId: string): Promise<void> {
    const invitationRef = this.db.collection(this.collection).withConverter(this.converter).doc(invitationId);
    await this.db.recursiveDelete(invitationRef);
  }

  /**
   * Updates the sender profile fields in an invitation document
   * @param ref The invitation document reference to update
   * @param newProfile The new sender profile data
   */
  async updateSenderProfile(ref: DocumentReference, newProfile: CreatorProfile): Promise<void> {
    ref.update({
      username: newProfile.username,
      name: newProfile.name,
      avatar: newProfile.avatar,
    });

    logger.info(`Updated sender profile for invitation ${ref.id}`);
  }
}
