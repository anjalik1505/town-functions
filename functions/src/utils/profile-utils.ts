import { differenceInYears, parse } from 'date-fns';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { Collections, InsightsFields, ProfileFields, } from '../models/constants.js';
import { FriendProfileResponse, Insights, ProfileResponse, } from '../models/data-models.js';
import { BadRequestError, NotFoundError } from './errors.js';
import { getLogger } from './logging-utils.js';
import { formatTimestamp } from './timestamp-utils.js';

import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Profile document result type
 */
type ProfileDocumentResult = {
  ref: FirebaseFirestore.DocumentReference;
  doc: FirebaseFirestore.DocumentSnapshot;
  data: FirebaseFirestore.DocumentData;
};

/**
 * Gets a profile document by user ID with optional error handling
 * @param userId The ID of the user whose profile to retrieve
 * @param throwIfNotFound Whether to throw an error if the profile doesn't exist
 * @returns The profile document and data, or null if not found and not throwing
 * @throws NotFoundError if the profile doesn't exist and throwIfNotFound is true
 */
const getProfileDocument = async (
  userId: string,
  throwIfNotFound: boolean = false,
): Promise<ProfileDocumentResult | null> => {
  const db = getFirestore();
  const profileRef = db.collection(Collections.PROFILES).doc(userId);
  const profileDoc = await profileRef.get();

  if (!profileDoc.exists) {
    logger.warn(`Profile not found for user ${userId}`);
    if (throwIfNotFound) {
      throw new NotFoundError(`Profile not found`);
    }
    return null;
  }

  return {
    ref: profileRef,
    doc: profileDoc,
    data: profileDoc.data() || {},
  };
};

/**
 * Fetches profile data for a user.
 *
 * @param userId - The ID of the user to fetch profile data for
 * @returns Profile data or null if not found
 */
export const fetchUserProfile = async (userId: string) => {
  const result = await getProfileDocument(userId, false);
  if (!result) {
    return null;
  }

  const profileData = result.data;
  return {
    username: profileData[ProfileFields.USERNAME] || '',
    name: profileData[ProfileFields.NAME] || '',
    avatar: profileData[ProfileFields.AVATAR] || '',
  };
};

/**
 * Fetches profile data for multiple users in parallel.
 *
 * @param userIds - Array of user IDs to fetch profile data for
 * @returns Map of user IDs to their profile data
 */
export const fetchUsersProfiles = async (userIds: string[]) => {
  const profiles = new Map<
    string,
    { username: string; name: string; avatar: string }
  >();
  const uniqueUserIds = Array.from(new Set(userIds));

  // Fetch profiles in parallel
  const profilePromises = uniqueUserIds.map(async (userId) => {
    const profile = await fetchUserProfile(userId);
    if (profile) {
      profiles.set(userId, profile);
    }
  });

  await Promise.all(profilePromises);
  return profiles;
};

/**
 * Enriches an object with profile data.
 *
 * @param item - The item to enrich with profile data
 * @param profile - The profile data to add
 * @returns The enriched item
 */
export const enrichWithProfile = <
  T extends { username?: string; name?: string; avatar?: string },
>(
  item: T,
  profile: { username: string; name: string; avatar: string } | null,
): T => {
  if (!profile) {
    return item;
  }

  return {
    ...item,
    username: profile.username,
    name: profile.name,
    avatar: profile.avatar,
  };
};

/**
 * Gets a profile document by user ID
 * @param userId The ID of the user whose profile to retrieve
 * @returns The profile document and data
 * @throws NotFoundError if the profile doesn't exist
 */
export const getProfileDoc = async (
  userId: string,
): Promise<ProfileDocumentResult> => {
  const result = await getProfileDocument(userId, true);
  // This should never be null because getProfileDocument will throw if not found
  return result as ProfileDocumentResult;
};

/**
 * Checks if a profile exists for a user
 * @param userId The ID of the user to check
 * @throws BadRequestError if the profile already exists
 */
export const profileExists = async (userId: string): Promise<void> => {
  const db = getFirestore();
  const profileRef = db.collection(Collections.PROFILES).doc(userId);
  const profileDoc = await profileRef.get();

  if (profileDoc.exists) {
    logger.warn(`Profile already exists for user ${userId}`);
    throw new BadRequestError(`Profile already exists for user ${userId}`);
  }
};

/**
 * Gets insights data for a profile
 * @param profileRef The reference to the profile document
 * @returns The insights data
 */
export const getProfileInsights = async (
  profileRef: FirebaseFirestore.DocumentReference,
): Promise<Insights> => {
  const insightsSnapshot = await profileRef
    .collection(Collections.INSIGHTS)
    .limit(1)
    .get();
  const insightsDoc = insightsSnapshot.docs[0];
  const insightsData = insightsDoc?.data() || {};

  return {
    emotional_overview: insightsData[InsightsFields.EMOTIONAL_OVERVIEW] || '',
    key_moments: insightsData[InsightsFields.KEY_MOMENTS] || '',
    recurring_themes: insightsData[InsightsFields.RECURRING_THEMES] || '',
    progress_and_growth: insightsData[InsightsFields.PROGRESS_AND_GROWTH] || '',
  };
};

/**
 * Formats the common profile fields from profile data
 * @param userId The ID of the user
 * @param profileData The profile data
 * @returns Common profile fields
 */
const formatCommonProfileFields = (
  userId: string,
  profileData: Record<string, unknown>,
) => {
  return {
    user_id: userId,
    username: (profileData[ProfileFields.USERNAME] as string) || '',
    name: (profileData[ProfileFields.NAME] as string) || '',
    avatar: (profileData[ProfileFields.AVATAR] as string) || '',
    location: (profileData[ProfileFields.LOCATION] as string) || '',
    birthday: (profileData[ProfileFields.BIRTHDAY] as string) || '',
    gender: (profileData[ProfileFields.GENDER] as string) || '',
    updated_at: profileData[ProfileFields.UPDATED_AT]
      ? formatTimestamp(profileData[ProfileFields.UPDATED_AT] as Timestamp)
      : '',
  };
};

/**
 * Formats a profile document into a ProfileResponse object
 * @param userId The ID of the user
 * @param profileData The profile data
 * @param insightsData The insights data
 * @returns A formatted ProfileResponse object
 */
export const formatProfileResponse = (
  userId: string,
  profileData: Record<string, unknown>,
  insightsData: Insights,
): ProfileResponse => {
  const commonFields = formatCommonProfileFields(userId, profileData);

  return {
    ...commonFields,
    notification_settings:
      (profileData[ProfileFields.NOTIFICATION_SETTINGS] as string[]) || [],
    summary: (profileData[ProfileFields.SUMMARY] as string) || '',
    suggestions: (profileData[ProfileFields.SUGGESTIONS] as string) || '',
    insights: insightsData,
  };
};

/**
 * Formats a profile document into a FriendProfileResponse object
 * @param userId The ID of the user
 * @param profileData The profile data
 * @param summary Optional summary text
 * @param suggestions Optional suggestions text
 * @returns A formatted FriendProfileResponse object
 */
export const formatFriendProfileResponse = (
  userId: string,
  profileData: Record<string, unknown>,
  summary: string = '',
  suggestions: string = '',
): FriendProfileResponse => {
  const commonFields = formatCommonProfileFields(userId, profileData);

  return {
    ...commonFields,
    summary,
    suggestions,
  };
};

/**
 * Calculates a person's age based on their birthday string in yyyy-mm-dd format
 * @param birthdayString The birthday string in yyyy-mm-dd format (already validated)
 * @returns The calculated age as a string, or "unknown" if the birthday string is empty
 */
export const calculateAge = (birthdayString: string): string => {
  // Return "unknown" if the birthday string is empty
  if (!birthdayString) {
    return 'unknown';
  }

  // Parse the birthday string into a Date object using date-fns
  const birthday = parse(birthdayString, 'yyyy-MM-dd', new Date());

  // Calculate age using date-fns differenceInYears function
  const age = differenceInYears(new Date(), birthday);

  return age.toString();
};

/**
 * Creates a consistent summary ID by sorting user IDs.
 * This ensures that the same summary ID is generated regardless of which user is first.
 *
 * @param userId1 - First user ID
 * @param userId2 - Second user ID
 * @returns A consistent summary ID in the format "user1_user2" where user1 and user2 are concatenated
 */
export const createSummaryId = (userId1: string, userId2: string): string => {
  return `${userId1}_${userId2}`;
};

/**
 * Checks if a user has a limit override
 * @param userId The ID of the user to check
 * @returns True if the user has a limit override, false otherwise
 */
export const hasLimitOverride = async (userId: string): Promise<boolean> => {
  const db = getFirestore();
  const profileRef = db.collection(Collections.PROFILES).doc(userId);
  const profileDoc = await profileRef.get();
  const profileData = profileDoc.data() || {};
  return profileData[ProfileFields.LIMIT_OVERRIDE] || false;
};
