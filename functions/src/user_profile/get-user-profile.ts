import { Request } from 'express';
import { getFirestore } from 'firebase-admin/firestore';
import { ApiResponse, EventName, ProfileEventParams } from '../models/analytics-events.js';
import { Collections, FriendshipFields, ProfileFields, Status, UserSummaryFields } from '../models/constants.js';
import { FriendProfileResponse } from '../models/data-models.js';
import { BadRequestError, ForbiddenError } from '../utils/errors.js';
import { createFriendshipId } from '../utils/friendship-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import { createSummaryId, formatFriendProfileResponse, getProfileDoc } from '../utils/profile-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Retrieves a user's profile with summary and suggestions.
 *
 * This function fetches the profile of the specified user, including their basic profile
 * information and aggregated summary data. Summary data is collected from shared groups
 * and direct chats between the current user and the requested user. The function enforces
 * friendship checks to ensure only friends can view each other's profiles.
 *
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - params: Route parameters containing:
 *                - target_user_id: The ID of the user whose profile is being requested
 *
 * @returns A FriendProfileResponse containing:
 * - Basic profile information (id, name, avatar)
 * - Location and birthday if available
 * - Summary and suggestions if available
 * - Updated timestamp
 *
 * @throws 400: Use /me/profile endpoint to view your own profile
 * @throws 404: Profile not found
 * @throws 403: You must be friends with this user to view their profile
 */
export const getUserProfile = async (req: Request): Promise<ApiResponse<FriendProfileResponse>> => {
  const currentUserId = req.userId;
  const targetUserId = req.params.target_user_id;

  logger.info(`Retrieving profile for user ${targetUserId} requested by ${currentUserId}`);

  const db = getFirestore();

  if (!targetUserId) {
    throw new BadRequestError('Target user ID is required');
  }

  // Redirect users to the appropriate endpoint for their own profile
  if (currentUserId === targetUserId) {
    logger.warn(`User ${currentUserId} attempted to view their own profile through /user endpoint`);
    throw new BadRequestError('Use /me/profile endpoint to view your own profile');
  }

  // Get the target user's profile using the utility function
  const { data: targetUserProfileData } = await getProfileDoc(targetUserId);

  // Check if users are friends using the unified friendships collection
  const friendshipId = createFriendshipId(currentUserId, targetUserId);
  const summaryId = createSummaryId(currentUserId, targetUserId);

  const friendshipRef = db.collection(Collections.FRIENDSHIPS).doc(friendshipId);
  const friendshipDoc = await friendshipRef.get();

  // If they are not friends, return an error
  if (!friendshipDoc.exists || friendshipDoc.data()?.[FriendshipFields.STATUS] !== Status.ACCEPTED) {
    logger.warn(`User ${currentUserId} attempted to view profile of non-friend ${targetUserId}`);
    throw new ForbiddenError('You must be friends with this user to view their profile');
  }

  logger.info(`Friendship verified between ${currentUserId} and ${targetUserId}`);

  // Get the user summary document for this friendship
  const userSummaryRef = db.collection(Collections.USER_SUMMARIES).doc(summaryId);
  const userSummaryDoc = await userSummaryRef.get();

  // Initialize summary and suggestions
  let summary = '';
  let suggestions = '';

  if (userSummaryDoc.exists) {
    const userSummaryData = userSummaryDoc.data() || {};
    // Only return the summary if the current user is the target (the one who should see it)
    if (userSummaryData[UserSummaryFields.TARGET_ID] === currentUserId) {
      summary = userSummaryData[UserSummaryFields.SUMMARY] || '';
      suggestions = userSummaryData[UserSummaryFields.SUGGESTIONS] || '';
      logger.info(`Retrieved user summary for relationship ${friendshipId}`);
    } else {
      logger.info(`User ${currentUserId} is not the target for this summary`);
    }
  } else {
    logger.info(`No user summary found for relationship ${friendshipId}`);
  }

  // Format and return the response
  const response = formatFriendProfileResponse(targetUserId, targetUserProfileData, summary, suggestions);

  // Track friend profile view event
  const event: ProfileEventParams = {
    has_name: !!targetUserProfileData[ProfileFields.NAME],
    has_avatar: !!targetUserProfileData[ProfileFields.AVATAR],
    has_location: !!targetUserProfileData[ProfileFields.LOCATION],
    has_birthday: !!targetUserProfileData[ProfileFields.BIRTHDAY],
    has_notification_settings:
      Array.isArray(targetUserProfileData[ProfileFields.NOTIFICATION_SETTINGS]) &&
      targetUserProfileData[ProfileFields.NOTIFICATION_SETTINGS].length > 0,
    has_gender: !!targetUserProfileData[ProfileFields.GENDER],
  };

  return {
    data: response,
    status: 200,
    analytics: {
      event: EventName.FRIEND_PROFILE_VIEWED,
      userId: currentUserId,
      params: event,
    },
  };
};
