import { DocumentData, Timestamp, UpdateData } from 'firebase-admin/firestore';
import { generateFriendProfileFlow } from '../ai/flows.js';
import { FriendSummaryEventParams } from '../models/analytics-events.js';
import { Collections, ProfileFields, UpdateFields, UserSummaryFields } from '../models/constants.js';
import { getLogger } from './logging-utils.js';
import { calculateAge, createSummaryId } from './profile-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Interface for profile data
 */
export interface ProfileData {
  name: string;
  gender: string;
  location: string;
  age: string;
}

/**
 * Interface for summary context data
 */
export interface SummaryContext {
  summaryId: string;
  summaryRef: FirebaseFirestore.DocumentReference;
  existingSummary: string;
  existingSuggestions: string;
  updateCount: number;
  isNewSummary: boolean;
  creatorProfile: ProfileData;
  friendProfile: ProfileData;
}

/**
 * Interface for summary result data
 */
export interface SummaryResult {
  summary: string;
  suggestions: string;
  updateId: string;
  analytics: FriendSummaryEventParams;
}

/**
 * Get the context data needed for summary generation
 *
 * @param db - Firestore client
 * @param creatorId - The ID of the user who created the update
 * @param friendId - The ID of the friend to process the summary for
 * @returns The summary context data
 */
export const getSummaryContext = async (
  db: FirebaseFirestore.Firestore,
  creatorId: string,
  friendId: string,
): Promise<SummaryContext> => {
  // Create a consistent relationship ID using the utility function
  const summaryId = createSummaryId(friendId, creatorId);

  // Get the existing summary document if it exists
  const summaryRef = db.collection(Collections.USER_SUMMARIES).doc(summaryId);
  const summaryDoc = await summaryRef.get();

  // Extract data from the existing summary or initialize new data
  let existingSummary = '';
  let existingSuggestions = '';
  let updateCount = 1;
  let isNewSummary = true;

  if (summaryDoc.exists) {
    const summaryData = summaryDoc.data() || {};
    existingSummary = summaryData[UserSummaryFields.SUMMARY] || '';
    existingSuggestions = summaryData[UserSummaryFields.SUGGESTIONS] || '';
    updateCount = (summaryData[UserSummaryFields.UPDATE_COUNT] || 0) + 1;
    isNewSummary = false;
  }

  // Get the creator's profile data
  const creatorProfileRef = db.collection(Collections.PROFILES).doc(creatorId);
  const creatorProfileDoc = await creatorProfileRef.get();

  let creatorProfile: ProfileData = {
    name: 'Friend',
    gender: 'unknown',
    location: 'unknown',
    age: 'unknown',
  };

  if (creatorProfileDoc.exists) {
    const creatorProfileData = creatorProfileDoc.data() || {};
    // Try to get name first, then username, then fall back to "Friend"
    creatorProfile = {
      name: creatorProfileData[ProfileFields.USERNAME] || creatorProfileData[ProfileFields.NAME] || 'Friend',
      gender: creatorProfileData[ProfileFields.GENDER] || 'unknown',
      location: creatorProfileData[ProfileFields.LOCATION] || 'unknown',
      age: calculateAge(creatorProfileData[ProfileFields.BIRTHDAY] || ''),
    };
  } else {
    logger.warn(`Creator profile not found: ${creatorId}`);
  }

  // Get the friend's profile data
  const friendProfileRef = db.collection(Collections.PROFILES).doc(friendId);
  const friendProfileDoc = await friendProfileRef.get();

  let friendProfile: ProfileData = {
    name: 'Friend',
    gender: 'unknown',
    location: 'unknown',
    age: 'unknown',
  };

  if (friendProfileDoc.exists) {
    const friendProfileData = friendProfileDoc.data() || {};
    friendProfile = {
      name: friendProfileData[ProfileFields.USERNAME] || friendProfileData[ProfileFields.NAME] || 'Friend',
      gender: friendProfileData[ProfileFields.GENDER] || 'unknown',
      location: friendProfileData[ProfileFields.LOCATION] || 'unknown',
      age: calculateAge(friendProfileData[ProfileFields.BIRTHDAY] || ''),
    };
  } else {
    logger.warn(`Friend profile not found: ${friendId}`);
  }

  return {
    summaryId,
    summaryRef,
    existingSummary,
    existingSuggestions,
    updateCount,
    isNewSummary,
    creatorProfile,
    friendProfile,
  };
};

/**
 * Generate a summary for a specific update
 *
 * @param context - The summary context data
 * @param updateData - The update document data
 * @returns The generated summary result
 */
export const generateFriendSummary = async (
  context: SummaryContext,
  updateData: Record<string, unknown>,
): Promise<SummaryResult> => {
  // Extract update content and sentiment
  const updateContent = (updateData[UpdateFields.CONTENT] as string) || '';
  const sentiment = (updateData[UpdateFields.SENTIMENT] as string) || '';
  const updateId = updateData[UpdateFields.ID] as string;

  // Use the friend profile flow to generate summary and suggestions
  const result = await generateFriendProfileFlow({
    existingSummary: context.existingSummary,
    existingSuggestions: context.existingSuggestions,
    updateContent: updateContent,
    sentiment: sentiment,
    friendName: context.friendProfile.name,
    friendGender: context.friendProfile.gender,
    friendLocation: context.friendProfile.location,
    friendAge: context.friendProfile.age,
    userName: context.creatorProfile.name,
    userGender: context.creatorProfile.gender,
    userLocation: context.creatorProfile.location,
    userAge: context.creatorProfile.age,
  });

  // Return the result with analytics data
  return {
    summary: result.summary || '',
    suggestions: result.suggestions || '',
    updateId,
    analytics: {
      summary_length: (result.summary || '').length,
      suggestions_length: (result.suggestions || '').length,
    },
  };
};

/**
 * Write a summary to the database
 *
 * @param context - The summary context data
 * @param result - The summary result data
 * @param creatorId - The ID of the user who created the update
 * @param friendId - The ID of the friend to process the summary for
 * @param batch - Firestore write batch for atomic operations
 */
export const writeFriendSummary = (
  context: SummaryContext,
  result: SummaryResult,
  creatorId: string,
  friendId: string,
  batch: FirebaseFirestore.WriteBatch,
): void => {
  // Prepare the summary document
  const now = Timestamp.now();
  const summaryUpdateData: UpdateData<DocumentData> = {
    [UserSummaryFields.CREATOR_ID]: creatorId,
    [UserSummaryFields.TARGET_ID]: friendId,
    [UserSummaryFields.SUMMARY]: result.summary,
    [UserSummaryFields.SUGGESTIONS]: result.suggestions,
    [UserSummaryFields.LAST_UPDATE_ID]: result.updateId,
    [UserSummaryFields.UPDATED_AT]: now,
    [UserSummaryFields.UPDATE_COUNT]: context.updateCount,
  };

  // If this is a new summary, add created_at
  if (context.isNewSummary) {
    summaryUpdateData[UserSummaryFields.CREATED_AT] = now;
  }

  // Add to batch instead of writing immediately
  batch.set(context.summaryRef, summaryUpdateData, { merge: true });
  logger.info(`Added summary update for summary ${context.summaryId} to batch`);
};

/**
 * Process a summary for a specific friend.
 *
 * @param db - Firestore client
 * @param updateData - The update document data
 * @param creatorId - The ID of the user who created the update
 * @param friendId - The ID of the friend to process the summary for
 * @param batch - Firestore write batch for atomic operations
 * @returns Analytics data for the friend summary
 */
export const processFriendSummary = async (
  db: FirebaseFirestore.Firestore,
  updateData: Record<string, unknown>,
  creatorId: string,
  friendId: string,
  batch: FirebaseFirestore.WriteBatch,
): Promise<FriendSummaryEventParams> => {
  // Get the summary context
  const context = await getSummaryContext(db, creatorId, friendId);

  // Generate the summary
  const result = await generateFriendSummary(context, updateData);

  // Write the summary to the database
  writeFriendSummary(context, result, creatorId, friendId, batch);

  // Return analytics data
  return result.analytics;
};
