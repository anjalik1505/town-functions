import { Request, Response } from "express";
import { Collections, Documents } from "../models/constants";
import { getLogger } from "../utils/logging-utils";
import { getProfileDoc } from "../utils/profile-utils";

const logger = getLogger(__filename);

/**
 * Deletes the profile of the authenticated user.
 * 
 * This function:
 * 1. Checks if a profile exists for the authenticated user
 * 2. If it exists, deletes the insights subcollection
 * 3. Then deletes the profile document
 * 
 * Note: The actual deletion of related data (updates, friendships, etc.) is handled by a Firestore trigger
 * that listens for profile deletions.
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 * @param res - The Express response object
 * 
 * @returns 204 No Content on successful deletion
 * 
 * @throws 404: Profile not found for user {user_id}
 */
export const deleteProfile = async (req: Request, res: Response): Promise<void> => {
  const currentUserId = req.userId;
  logger.info(`Starting delete_profile operation for user ID: ${currentUserId}`);

  // Get the profile document using the utility function (throws NotFoundError if not found)
  const { ref: profileRef } = await getProfileDoc(currentUserId);

  // Delete the insights subcollection first
  const insightsRef = profileRef.collection(Collections.INSIGHTS).doc(Documents.DEFAULT_INSIGHTS);
  const insightsDoc = await insightsRef.get();
  if (insightsDoc.exists) {
    await insightsRef.delete();
    logger.info(`Deleted insights document for user ${currentUserId}`);
  }

  // Delete the profile document
  await profileRef.delete();
  logger.info(`Profile document deleted for user ${currentUserId}`);

  // Return 204 No Content for successful deletion (no response body)
  res.status(204).end();
};
