import { Request, Response } from 'express';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { ProfileFields } from '../models/constants.js';
import { Location, LocationPayload } from '../models/data-models.js';
import { getLogger } from '../utils/logging-utils.js';
import { getProfileDoc } from '../utils/profile-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';

const logger = getLogger('update-location');

/**
 * Updates the authenticated user's location information.
 *
 * This function:
 * 1. Retrieves the user's profile
 * 2. Updates the location field with the provided value
 * 3. Returns a response with the updated location
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Location data including:
 *                - location: The user's location in City/Country format
 * @param res - The Express response object
 *
 * @returns An ApiResponse with success status and the updated location
 */
export const updateLocation = async (req: Request, res: Response): Promise<void> => {
  const currentUserId = req.userId;
  logger.info(`Starting update_location operation for user ID: ${currentUserId}`);

  const locationData = req.validated_params as LocationPayload;
  const newLocation = locationData.location;

  // Get the profile document using the utility function
  const { ref: profileRef } = await getProfileDoc(currentUserId);

  const currentTime = Timestamp.now();
  // Create a batch to ensure database operations are atomic
  const db = getFirestore();
  const batch = db.batch();

  // Update profile with new location
  batch.update(profileRef, {
    [ProfileFields.LOCATION]: newLocation,
    [ProfileFields.UPDATED_AT]: currentTime,
  });

  // Commit the batch
  await batch.commit();
  logger.info(`Batch operation completed successfully for user ${currentUserId}`);

  const location: Location = {
    location: newLocation,
    updated_at: formatTimestamp(currentTime),
  };

  res.json(location);
};
