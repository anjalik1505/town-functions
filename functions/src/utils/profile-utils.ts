import { differenceInYears, parse } from 'date-fns';
import { getFirestore } from 'firebase-admin/firestore';
import { Collections } from '../models/constants.js';
import { Insights, NudgingSettings, ProfileResponse } from '../models/data-models.js';
import { profileConverter, ProfileDoc } from '../models/firestore/index.js';
import { ConnectTo, Goals } from '../models/firestore/profile-doc.js';
import { NotFoundError } from './errors.js';
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
