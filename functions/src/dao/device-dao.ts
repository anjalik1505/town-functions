import { Timestamp } from 'firebase-admin/firestore';
import { BaseDAO } from './base-dao.js';
import { DeviceDoc, deviceConverter } from '../models/firestore/device-doc.js';
import { Collections } from '../models/constants.js';

export class DeviceDAO extends BaseDAO<DeviceDoc> {
  constructor() {
    super(Collections.DEVICES, deviceConverter);
  }

  /**
   * Upserts a device document for a user.
   * Creates or updates the device with the specified device_id and current timestamp.
   *
   * @param userId - The user ID (used as document ID)
   * @param deviceId - The device ID to store
   * @returns The device document that was written
   */
  async upsertDevice(userId: string, deviceId: string): Promise<DeviceDoc> {
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
  async deviceExists(userId: string): Promise<boolean> {
    const doc = await this.db.collection(this.collection).withConverter(this.converter).doc(userId).get();

    return doc.exists;
  }
}
