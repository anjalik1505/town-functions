import { Timestamp } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { Collections } from '../models/constants.js';
import { nudgeConverter, NudgeDoc } from '../models/firestore/nudge-doc.js';
import { getLogger } from '../utils/logging-utils.js';
import { BaseDAO } from './base-dao.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Data Access Object for Nudge operations
 * Manages nudges subcollection under profiles
 */
export class NudgeDAO extends BaseDAO<NudgeDoc> {
  constructor() {
    super(Collections.PROFILES, nudgeConverter, Collections.NUDGES);
  }

  /**
   * Gets the nudge collection reference for a user
   */
  private get(userId: string) {
    return this.db
      .collection(this.collection)
      .doc(userId)
      .collection(this.subcollection!)
      .withConverter(this.converter);
  }

  /**
   * Gets the nudge sent from a specific sender to a receiver
   * @returns The nudge document or null if no nudge exists
   */
  async getLastNudge(receiverId: string, senderId: string): Promise<NudgeDoc | null> {
    // Since we use sender ID as document ID, we can get it directly
    const nudgeRef = this.get(receiverId).doc(senderId);
    const nudgeDoc = await nudgeRef.get();

    if (!nudgeDoc.exists) {
      return null;
    }

    return nudgeDoc.data() || null;
  }

  /**
   * Creates or updates a nudge record (upsert)
   * Uses sender ID as document ID for easy updates
   */
  async upsert(receiverId: string, senderId: string): Promise<void> {
    // Use sender ID as document ID for deterministic updates
    const nudgeRef = this.get(receiverId).doc(senderId);

    const nudgeData: NudgeDoc = {
      sender_id: senderId,
      receiver_id: receiverId,
      timestamp: Timestamp.now(),
    };

    await nudgeRef.set(nudgeData);
    logger.info(`Upserted nudge from ${senderId} to ${receiverId}`);
  }

  /**
   * Checks if a nudge can be sent (respects cooldown period)
   * @param cooldownMs The cooldown period in milliseconds
   * @returns true if nudge can be sent, false if still in cooldown
   */
  async canSend(receiverId: string, senderId: string, cooldownMs: number): Promise<boolean> {
    const lastNudge = await this.getLastNudge(receiverId, senderId);

    if (!lastNudge) {
      return true; // No previous nudge exists
    }

    const lastNudgeTime = lastNudge.timestamp.toMillis();
    const now = Date.now();

    return now - lastNudgeTime >= cooldownMs;
  }
}
