import { differenceInYears, parse } from 'date-fns';
import { getFirestore } from 'firebase-admin/firestore';
import { Collections } from '../models/constants.js';
import { ConnectTo, Goals } from '../models/firestore/profile-doc.js';
import { FriendProfileResponse, Insights, NudgingSettings, ProfileResponse } from '../models/data-models.js';
import { profileConverter, ProfileDoc, insightsConverter, insf, InsightsDoc } from '../models/firestore/index.js';
import { BadRequestError, NotFoundError } from './errors.js';
import { getLogger } from './logging-utils.js';
import { formatTimestamp } from './timestamp-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Profile document result type
 */
type ProfileDocumentResult = {
  ref: FirebaseFirestore.DocumentReference<ProfileDoc>;
  doc: FirebaseFirestore.DocumentSnapshot<ProfileDoc>;
  data: ProfileDoc;
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
  const profileRef = db.collection(Collections.PROFILES).withConverter(profileConverter).doc(userId);
  const profileDoc = await profileRef.get();

  if (!profileDoc.exists) {
    logger.warn(`Profile not found for user ${userId}`);
    if (throwIfNotFound) {
      throw new NotFoundError(`Profile not found`);
    }
    return null;
  }

  const data = profileDoc.data();
  if (!data) {
    throw new Error(`Profile data is undefined for user ${userId}`);
  }

  return {
    ref: profileRef,
    doc: profileDoc,
    data,
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
    username: profileData.username || '',
    name: profileData.name || '',
    avatar: profileData.avatar || '',
  };
};

/**
 * Fetches profile data for multiple users in parallel.
 *
 * @param userIds - Array of user IDs to fetch profile data for
 * @returns Map of user IDs to their profile data
 */
export const fetchUsersProfiles = async (userIds: string[]) => {
  const profiles = new Map<string, { username: string; name: string; avatar: string }>();
  const uniqueUserIds = Array.from(new Set(userIds));

  // Return early if no user IDs to fetch
  if (uniqueUserIds.length === 0) {
    return profiles;
  }

  const db = getFirestore();

  // Create document references for all unique user IDs with converter
  const profilesCollection = db.collection(Collections.PROFILES).withConverter(profileConverter);
  const refs = uniqueUserIds.map((userId) => profilesCollection.doc(userId));

  // Fetch all documents in one batch operation
  const docs = await db.getAll(...refs);

  // Process the results
  docs.forEach((doc, index) => {
    if (doc.exists) {
      const profileData = doc.data();
      const userId = uniqueUserIds[index];
      if (userId && profileData) {
        profiles.set(userId, {
          username: profileData.username || '',
          name: profileData.name || '',
          avatar: profileData.avatar || '',
        });
      }
    }
  });

  return profiles;
};

/**
 * Enriches an object with profile data.
 *
 * @param item - The item to enrich with profile data
 * @param profile - The profile data to add
 * @returns The enriched item
 */
export const enrichWithProfile = <T extends { username?: string; name?: string; avatar?: string }>(
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
export const getProfileDoc = async (userId: string): Promise<ProfileDocumentResult> => {
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
  const profileRef = db.collection(Collections.PROFILES).withConverter(profileConverter).doc(userId);
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
  profileRef: FirebaseFirestore.DocumentReference<ProfileDoc>,
): Promise<Insights> => {
  const insightsSnapshot = await profileRef
    .collection(Collections.INSIGHTS)
    .withConverter(insightsConverter)
    .limit(1)
    .get();
  const insightsDoc = insightsSnapshot.docs[0];
  const insightsData = insightsDoc?.data() || ({} as Partial<InsightsDoc>);

  return {
    emotional_overview: insightsData[insf('emotional_overview')] || '',
    key_moments: insightsData[insf('key_moments')] || '',
    recurring_themes: insightsData[insf('recurring_themes')] || '',
    progress_and_growth: insightsData[insf('progress_and_growth')] || '',
  };
};

/**
 * Formats the common profile fields from profile data
 * @param userId The ID of the user
 * @param profileData The profile data
 * @returns Common profile fields
 */
const formatCommonProfileFields = (userId: string, profileData: ProfileDoc) => {
  return {
    user_id: userId,
    username: profileData.username || '',
    name: profileData.name || '',
    avatar: profileData.avatar || '',
    location: profileData.location || '',
    birthday: profileData.birthday || '',
    gender: profileData.gender || '',
    timezone: profileData.timezone || '',
    updated_at: profileData.updated_at ? formatTimestamp(profileData.updated_at) : '',
  };
};

/**
 * Safely extracts and formats nudging settings from profile data
 * @param profileData The profile data from Firestore
 * @returns Properly formatted NudgingSettings or null
 */
const extractNudgingSettings = (profileData: ProfileDoc): NudgingSettings | null => {
  const nudgingSettings = profileData.nudging_settings;

  // Return null if nudging_settings doesn't exist or is null
  if (!nudgingSettings) {
    return null;
  }

  // Return the nudging settings as is, since it's already typed
  return nudgingSettings;
};

/**
 * Safely extracts nudging occurrence from profile data for analytics
 * @param profileData The profile data from Firestore
 * @returns The nudging occurrence string or empty string if not set
 */
export const extractNudgingOccurrence = (profileData: ProfileDoc): string => {
  const nudgingSettings = extractNudgingSettings(profileData);
  return nudgingSettings?.occurrence || '';
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
  profileData: ProfileDoc,
  insightsData: Insights,
): ProfileResponse => {
  const commonFields = formatCommonProfileFields(userId, profileData);

  // Handle nudging_settings as a nested object
  const nudgingSettings = extractNudgingSettings(profileData);

  return {
    ...commonFields,
    notification_settings: profileData.notification_settings || [],
    nudging_settings: nudgingSettings,
    summary: profileData.summary || '',
    suggestions: profileData.suggestions || '',
    insights: insightsData,
    tone: profileData.tone || '',
    phone_number: profileData.phone_number || '',
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
  profileData: ProfileDoc,
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
  const profileRef = db.collection(Collections.PROFILES).withConverter(profileConverter).doc(userId);
  const profileDoc = await profileRef.get();
  const profileData = profileDoc.data();
  return !!profileData?.limit_override;
};

/**
 * Safely extracts goal value for analytics, mapping unknown values to fallback
 * @param profileData The profile data from Firestore
 * @returns The goal string or "something_else" if not in predefined options
 */
export const extractGoalForAnalytics = (profileData: ProfileDoc): string => {
  const goal = profileData.goal;
  if (!goal) return '';

  // Check if the goal matches any predefined option
  const predefinedGoals = Object.values(Goals) as string[];
  if (predefinedGoals.includes(goal)) {
    return goal;
  }

  // Return fallback for any free-form text
  return 'something_else';
};

/**
 * Safely extracts connect_to value for analytics, mapping unknown values to fallback
 * @param profileData The profile data from Firestore
 * @returns The connect_to string or "other" if not in predefined options
 */
export const extractConnectToForAnalytics = (profileData: ProfileDoc): string => {
  const connectTo = profileData.connect_to?.[0];
  if (!connectTo) return '';

  // Check if the connect_to matches any predefined option
  const predefinedOptions = Object.values(ConnectTo) as string[];
  if (predefinedOptions.includes(connectTo)) {
    return connectTo;
  }

  // Return fallback for any free-form text
  return 'other';
};
