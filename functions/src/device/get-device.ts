import { Request, Response } from 'express';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { Collections, DeviceFields } from '../models/constants.js';
import { Device } from '../models/data-models.js';
import { NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Get the device information for the authenticated user.
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 * @param res - The Express response object
 *
 * @returns A Device object containing the device information if found
 *
 * @throws {404} Device not found
 */
export const getDevice = async (req: Request, res: Response): Promise<void> => {
  const currentUserId = req.userId;
  logger.info(`Getting device for user ${currentUserId}`);

  // Reference to the user's device document
  const db = getFirestore();
  const deviceRef = db.collection(Collections.DEVICES).doc(currentUserId);

  // Get the device document
  const deviceDoc = await deviceRef.get();
  if (!deviceDoc.exists) {
    logger.warn(`Device not found for user ${currentUserId}`);
    throw new NotFoundError('Device not found');
  }

  // Get device data and create Device object
  const deviceData = deviceDoc.data();
  logger.info(`Device retrieved for user ${currentUserId}`);

  // Format timestamp for consistent API response
  const updatedAt = deviceData?.[DeviceFields.UPDATED_AT] as Timestamp;
  const updatedAtIso = updatedAt ? formatTimestamp(updatedAt) : '';

  const device: Device = {
    device_id: deviceData?.[DeviceFields.DEVICE_ID] || '',
    updated_at: updatedAtIso,
  };

  res.json(device);
};
