import { Timestamp } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateFriendProfileFlow } from '../ai/flows.js';
import { FriendSummaryEventParams } from '../models/analytics-events.js';
import { Collections } from '../models/constants.js';
import { ProfileData, SummaryContext, SummaryResult } from '../models/data-models.js';
import { profileConverter, UpdateDoc } from '../models/firestore/index.js';
import { UserSummaryDoc } from '../models/firestore/user-summary-doc.js';
import { getLogger } from './logging-utils.js';
import { calculateAge, createSummaryId } from './profile-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

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
  let existingCreatedAt: Timestamp | undefined = undefined;

  if (summaryDoc.exists) {
    const summaryData = summaryDoc.data() as UserSummaryDoc | undefined;
    if (summaryData) {
      existingSummary = summaryData.summary || '';
      existingSuggestions = summaryData.suggestions || '';
      updateCount = (summaryData.update_count || 0) + 1;
      isNewSummary = false;
      existingCreatedAt = summaryData.created_at;
    }
  }

  // Get the creator's profile data
  const creatorProfileRef = db.collection(Collections.PROFILES).withConverter(profileConverter).doc(creatorId);
  const creatorProfileDoc = await creatorProfileRef.get();

  let creatorProfile: ProfileData = {
    name: 'Friend',
    gender: 'unknown',
    location: 'unknown',
    age: 'unknown',
  };

  const creatorProfileData = creatorProfileDoc.data();
  if (creatorProfileData) {
    // Try to get name first, then username, then fall back to "Friend"
    creatorProfile = {
      name: creatorProfileData.username || creatorProfileData.name || 'Friend',
      gender: creatorProfileData.gender || 'unknown',
      location: creatorProfileData.location || 'unknown',
      age: calculateAge(creatorProfileData.birthday || ''),
    };
  } else {
    logger.warn(`Creator profile not found: ${creatorId}`);
  }

  // Get the friend's profile data
  const friendProfileRef = db.collection(Collections.PROFILES).withConverter(profileConverter).doc(friendId);
  const friendProfileDoc = await friendProfileRef.get();

  let friendProfile: ProfileData = {
    name: 'Friend',
    gender: 'unknown',
    location: 'unknown',
    age: 'unknown',
  };

  const friendProfileData = friendProfileDoc.data();
  if (friendProfileData) {
    friendProfile = {
      name: friendProfileData.username || friendProfileData.name || 'Friend',
      gender: friendProfileData.gender || 'unknown',
      location: friendProfileData.location || 'unknown',
      age: calculateAge(friendProfileData.birthday || ''),
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
    existingCreatedAt,
    creatorProfile,
    friendProfile,
  };
};

/**
 * Generate a summary for a specific update
 *
 * @param context - The summary context data
 * @param updateData - The update document data
 * @param imageAnalysis - Already analyzed image description text
 * @returns The generated summary result
 */
export const generateFriendSummary = async (
  context: SummaryContext,
  updateData: UpdateDoc,
  imageAnalysis: string,
): Promise<SummaryResult> => {
  // Extract update content and sentiment
  const updateContent = updateData.content || '';
  const sentiment = updateData.sentiment || '';
  const updateId = updateData.id;

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
    imageAnalysis: imageAnalysis,
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
  const summaryData: UserSummaryDoc = {
    creator_id: creatorId,
    target_id: friendId,
    summary: result.summary,
    suggestions: result.suggestions,
    last_update_id: result.updateId,
    created_at: context.isNewSummary ? now : context.existingCreatedAt || now,
    updated_at: now,
    update_count: context.updateCount,
  };

  // Add to batch instead of writing immediately
  batch.set(context.summaryRef, summaryData, { merge: true });
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
 * @param imageAnalysis - Already analyzed image description text
 * @returns Analytics data for the friend summary
 */
export const processFriendSummary = async (
  db: FirebaseFirestore.Firestore,
  updateData: UpdateDoc,
  creatorId: string,
  friendId: string,
  batch: FirebaseFirestore.WriteBatch,
  imageAnalysis: string,
): Promise<FriendSummaryEventParams> => {
  // Get the summary context
  const context = await getSummaryContext(db, creatorId, friendId);

  // Generate the summary
  const result = await generateFriendSummary(context, updateData, imageAnalysis);

  // Write the summary to the database
  writeFriendSummary(context, result, creatorId, friendId, batch);

  // Return analytics data
  return result.analytics;
};
