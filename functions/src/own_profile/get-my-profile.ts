import { Request, Response } from "express";
import { getLogger } from "../utils/logging-utils";
import { formatProfileResponse, getProfileDoc, getProfileInsights } from "../utils/profile-utils";

const logger = getLogger(__filename);

/**
 * Retrieves the current user's profile with insights information.
 * 
 * This function:
 * 1. Fetches the authenticated user's profile data from Firestore
 * 2. Retrieves any available insights data
 * 3. Combines the data into a comprehensive profile response
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 * @param res - The Express response object
 * 
 * @returns A ProfileResponse containing:
 * - Basic profile information (id, username, name, avatar)
 * - Optional profile fields (location, birthday, notification_settings, summary, suggestions)
 * - Insights information (emotional overview, key moments, themes, growth)
 * 
 * @throws 404: Profile not found
 */
export const getProfile = async (req: Request, res: Response): Promise<void> => {
  const currentUserId = req.userId;
  logger.info(`Retrieving profile for user: ${currentUserId}`);

  // Get the profile document using the utility function
  const { ref: profileRef, data: profileData } = await getProfileDoc(currentUserId);

  // Get insights data
  const insightsData = await getProfileInsights(profileRef);

  // Format and return the response
  const response = formatProfileResponse(currentUserId, profileData, insightsData);

  res.json(response);
}; 