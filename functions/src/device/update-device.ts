import { Request, Response } from 'express';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { Collections, DeviceFields } from '../models/constants';
import { Device } from '../models/data-models';
import { getLogger } from '../utils/logging-utils';
import { formatTimestamp } from '../utils/timestamp-utils';

const logger = getLogger(__filename);

/**
 * Update the device ID for the authenticated user.
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: The validated request parameters containing:
 *                - device_id: The new device ID to set
 * @param res - The Express response object
 *
 * @returns A Device object containing the updated device information
 */
export const updateDevice = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const currentUserId = req.userId;
  logger.info(`Updating device for user ${currentUserId}`);

  // Get validated data from request
  const deviceDataInput = req.validated_params;

  const currentTime = Timestamp.now();

  // Reference to the user's device document
  const db = getFirestore();
  const deviceRef = db.collection(Collections.DEVICES).doc(currentUserId);

  // Create or update the device document
  const deviceData = {
    [DeviceFields.DEVICE_ID]: deviceDataInput.device_id,
    [DeviceFields.UPDATED_AT]: currentTime,
  };

  // Update the device document
  await deviceRef.set(deviceData, { merge: true });
  logger.info(`Device updated for user ${currentUserId}`);

  // Create and return a Device object
  const device: Device = {
    device_id: deviceDataInput.device_id,
    updated_at: formatTimestamp(currentTime),
  };

  res.json(device);
};
