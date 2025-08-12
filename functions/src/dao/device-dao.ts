import { Timestamp } from 'firebase-admin/firestore';
import { Collections } from '../models/constants.js';
import { DeviceDoc, deviceConverter } from '../models/firestore/index.js';
import { BaseDAO } from './base-dao.js';

export class DeviceDAO extends BaseDAO<DeviceDoc> {
  constructor() {
    super(Collections.DEVICES, deviceConverter);
  }

  /**
   * Gets a device document by ID.
   */
  async get(id: string): Promise<DeviceDoc | null> {
    const doc = await this.db.collection(this.collection).withConverter(this.converter).doc(id).get();
    return doc.exists ? (doc.data() ?? null) : null;
  }

  /**
   * Upserts a device document for a user.
   * Creates or updates the device with the specified device_id and current timestamp.
   *
   * @param userId - The user ID (used as document ID)
   * @param deviceId - The device ID to store
   * @returns The device document that was written
   */
  async upsert(userId: string, deviceId: string): Promise<DeviceDoc> {
    const currentTime = Timestamp.now();

    const deviceData: DeviceDoc = {
      device_id: deviceId,
      updated_at: currentTime,
    };

    await this.db
      .collection(this.collection)
      .withConverter(this.converter)
      .doc(userId)
      .set(deviceData, { merge: true });

    return deviceData;
  }

  /**
   * Checks if a device exists for the specified user.
   *
   * @param userId - The user ID to check
   * @returns True if device exists, false otherwise
   */
  async exists(userId: string): Promise<boolean> {
    const doc = await this.db.collection(this.collection).withConverter(this.converter).doc(userId).get();

    return doc.exists;
  }

  /**
   * Deletes the device document for a user if it exists.
   * Used for internal cleanup operations.
   *
   * @param userId - The user ID
   * @returns Count of devices deleted (0 or 1)
   */
  async delete(userId: string): Promise<number> {
    const ref = this.db.collection(this.collection).withConverter(this.converter).doc(userId);
    const doc = await ref.get();
    if (!doc.exists) {
      return 0;
    }

    await ref.delete();
    return 1;
  }
}
