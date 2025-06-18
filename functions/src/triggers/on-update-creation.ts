import { getFirestore, QueryDocumentSnapshot, Timestamp } from 'firebase-admin/firestore';
import { FirestoreEvent } from 'firebase-functions/v2/firestore';
import { analyzeImagesFlow, generateCreatorProfileFlow } from '../ai/flows.js';
import { EventName, FriendSummaryEventParams, SummaryEventParams } from '../models/analytics-events.js';
import { Collections, Documents, InsightsFields, ProfileFields, UpdateFields } from '../models/constants.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import {
  getFriendDoc,
  migrateFriendDocsForUser,
  upsertFriendDoc,
  type FriendDocUpdate,
} from '../utils/friendship-utils.js';
import { processImagesForPrompt } from '../utils/image-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import {
  calculateAge,
  extractConnectToForAnalytics,
  extractGoalForAnalytics,
  extractNudgingOccurrence,
} from '../utils/profile-utils.js';
import { processFriendSummary } from '../utils/summary-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Update the creator's own profile with summary, suggestions, and insights.
 *
 * @param db - Firestore client
 * @param updateData - The update document data
 * @param creatorId - The ID of the user who created the update
 * @param batch - Firestore write batch for atomic operations
 * @param imageAnalysis - Already analyzed image description text
 * @returns Analytics data for the creator's profile update
 */
const updateCreatorProfile = async (
  db: FirebaseFirestore.Firestore,
  updateData: Record<string, unknown>,
  creatorId: string,
  batch: FirebaseFirestore.WriteBatch,
  imageAnalysis: string,
): Promise<{
  summary_length: number;
  suggestions_length: number;
  emotional_overview_length: number;
  key_moments_length: number;
  recurring_themes_length: number;
  progress_and_growth_length: number;
  has_name: boolean;
  has_avatar: boolean;
  has_location: boolean;
  has_birthday: boolean;
  has_gender: boolean;
  nudging_occurrence: string;
  goal: string;
  connect_to: string;
  personality: string;
  tone: string;
}> => {
  // Get the profile document
  const profileRef = db.collection(Collections.PROFILES).doc(creatorId);
  const profileDoc = await profileRef.get();

  if (!profileDoc.exists) {
    logger.warn(`Profile not found for user ${creatorId}`);
    return {
      summary_length: 0,
      suggestions_length: 0,
      emotional_overview_length: 0,
      key_moments_length: 0,
      recurring_themes_length: 0,
      progress_and_growth_length: 0,
      has_name: false,
      has_avatar: false,
      has_location: false,
      has_birthday: false,
      has_gender: false,
      nudging_occurrence: '',
      goal: '',
      connect_to: '',
      personality: '',
      tone: '',
    };
  }

  // Extract data from the profile
  const profileData = profileDoc.data() || {};
  const existingSummary = profileData[ProfileFields.SUMMARY];
  const existingSuggestions = profileData[ProfileFields.SUGGESTIONS];

  // Extract update content and sentiment
  const updateContent = updateData[UpdateFields.CONTENT] as string;
  const sentiment = updateData[UpdateFields.SENTIMENT] as string;
  const updateId = updateData[UpdateFields.ID] as string;

  // Get insight data from the profile's insight subcollection
  const insightsSnapshot = await profileRef.collection(Collections.INSIGHTS).limit(1).get();
  const insightsDoc = insightsSnapshot.docs[0];
  const existingInsights = insightsDoc?.data() || {};

  // Calculate age from the birthday
  const age = calculateAge(profileData[ProfileFields.BIRTHDAY] || '');

  // Use the creator profile flow to generate insights
  const result = await generateCreatorProfileFlow({
    existingSummary: existingSummary || '',
    existingSuggestions: existingSuggestions || '',
    existingEmotionalOverview: existingInsights[InsightsFields.EMOTIONAL_OVERVIEW] || '',
    existingKeyMoments: existingInsights[InsightsFields.KEY_MOMENTS] || '',
    existingRecurringThemes: existingInsights[InsightsFields.RECURRING_THEMES] || '',
    existingProgressAndGrowth: existingInsights[InsightsFields.PROGRESS_AND_GROWTH] || '',
    updateContent: updateContent || '',
    sentiment: sentiment || '',
    gender: profileData[ProfileFields.GENDER] || 'unknown',
    location: profileData[ProfileFields.LOCATION] || 'unknown',
    age: age,
    imageAnalysis: imageAnalysis,
  });

  // Update the profile
  const profileUpdate = {
    [ProfileFields.SUMMARY]: result.summary || '',
    [ProfileFields.SUGGESTIONS]: result.suggestions || '',
    [ProfileFields.LAST_UPDATE_ID]: updateId,
    [ProfileFields.UPDATED_AT]: Timestamp.now(),
  };

  // Add profile update to batch
  batch.update(profileRef, profileUpdate);
  logger.info(`Added profile update for user ${creatorId} to batch`);

  // Update or create the insights document
  const insightsData = {
    [InsightsFields.EMOTIONAL_OVERVIEW]: result.emotional_overview || '',
    [InsightsFields.KEY_MOMENTS]: result.key_moments || '',
    [InsightsFields.RECURRING_THEMES]: result.recurring_themes || '',
    [InsightsFields.PROGRESS_AND_GROWTH]: result.progress_and_growth || '',
  };

  const insightsRef = insightsDoc
    ? insightsDoc.ref
    : profileRef.collection(Collections.INSIGHTS).doc(Documents.DEFAULT_INSIGHTS);

  // Add insight update to batch
  batch.set(insightsRef, insightsData, { merge: true });
  logger.info(`Added insights update for user ${creatorId} to batch`);

  return {
    summary_length: (result.summary || '').length,
    suggestions_length: (result.suggestions || '').length,
    emotional_overview_length: (result.emotional_overview || '').length,
    key_moments_length: (result.key_moments || '').length,
    recurring_themes_length: (result.recurring_themes || '').length,
    progress_and_growth_length: (result.progress_and_growth || '').length,
    has_name: !!profileData[ProfileFields.NAME],
    has_avatar: !!profileData[ProfileFields.AVATAR],
    has_location: !!profileData[ProfileFields.LOCATION],
    has_birthday: !!profileData[ProfileFields.BIRTHDAY],
    has_gender: !!profileData[ProfileFields.GENDER],
    nudging_occurrence: extractNudgingOccurrence(profileData),
    goal: extractGoalForAnalytics(profileData),
    connect_to: extractConnectToForAnalytics(profileData),
    personality: (profileData[ProfileFields.PERSONALITY] as string) || '',
    tone: (profileData[ProfileFields.TONE] as string) || '',
  };
};

/**
 * Process summaries for all friends and the creator in parallel.
 *
 * @param db - Firestore client
 * @param updateData - The update document data
 * @returns Analytics data about the summary processing
 */
const processAllSummaries = async (
  db: FirebaseFirestore.Firestore,
  updateData: Record<string, unknown>,
): Promise<{
  mainSummary: SummaryEventParams;
  friendSummaries: FriendSummaryEventParams[];
}> => {
  const creatorId = updateData[UpdateFields.CREATED_BY] as string;
  const friendIds = (updateData[UpdateFields.FRIEND_IDS] as string[]) || [];

  if (!creatorId) {
    logger.error('Update has no creator ID');
    return {
      mainSummary: {
        update_length: 0,
        update_sentiment: '',
        summary_length: 0,
        suggestions_length: 0,
        emotional_overview_length: 0,
        key_moments_length: 0,
        recurring_themes_length: 0,
        progress_and_growth_length: 0,
        has_name: false,
        has_avatar: false,
        has_location: false,
        has_birthday: false,
        has_gender: false,
        nudging_occurrence: '',
        goal: '',
        connect_to: '',
        personality: '',
        tone: '',
        friend_summary_count: 0,
      },
      friendSummaries: [],
    };
  }

  // Process images once for all summaries
  const imagePaths = (updateData[UpdateFields.IMAGE_PATHS] as string[]) || [];
  const processedImages = await processImagesForPrompt(imagePaths);

  // Analyze images once for all summaries
  const { analysis: imageAnalysis } = await analyzeImagesFlow({ images: processedImages });

  // Create a batch for atomic writes
  const batch = db.batch();

  // Create tasks for all friends and the creator
  const tasks = [];

  // Add a task for updating the creator's profile
  tasks.push(updateCreatorProfile(db, updateData, creatorId, batch, imageAnalysis));

  // Add tasks for all friends
  for (const friendId of friendIds) {
    tasks.push(processFriendSummary(db, updateData, creatorId, friendId, batch, imageAnalysis));
  }

  // Migrate creator's friend docs and update friend documents with emoji
  await migrateFriendDocsForUser(creatorId);
  const emoji = updateData[UpdateFields.EMOJI] as string;
  if (emoji) {
    const friendshipUpdateTasks = friendIds.map(async (friendId) => {
      // Check if they are friends using the new system and get friend data
      const friendDocResult = await getFriendDoc(creatorId, friendId);

      if (friendDocResult) {
        // Ensure friend's friend subcollection exists and update their doc
        await migrateFriendDocsForUser(friendId);

        const friendDocUpdate: FriendDocUpdate = {
          last_update_emoji: emoji,
          last_update_at: updateData[UpdateFields.CREATED_AT] as Timestamp,
        };
        upsertFriendDoc(db, friendId, creatorId, friendDocUpdate, batch);
      }
      // If not friends, just skip - no error needed
    });
    tasks.push(...friendshipUpdateTasks);
  }

  // Run all tasks in parallel
  const results = await Promise.all(tasks);

  // Commit the batch
  if (tasks.length > 0) {
    await batch.commit();
    logger.info(`Committed batch with ${tasks.length} summary updates`);
  }

  // The first result is from updateCreatorProfile
  const creatorResult = results[0] as {
    summary_length: number;
    suggestions_length: number;
    emotional_overview_length: number;
    key_moments_length: number;
    recurring_themes_length: number;
    progress_and_growth_length: number;
    has_name: boolean;
    has_avatar: boolean;
    has_location: boolean;
    has_birthday: boolean;
    has_gender: boolean;
    nudging_occurrence: string;
    goal: string;
    connect_to: string;
    personality: string;
    tone: string;
  };

  // The rest of the results are from friend summaries
  const friendResults = results.slice(1) as FriendSummaryEventParams[];

  // Return all analytics data
  return {
    mainSummary: {
      update_length: ((updateData[UpdateFields.CONTENT] as string) || '').length,
      update_sentiment: (updateData[UpdateFields.SENTIMENT] as string) || '',
      summary_length: creatorResult.summary_length,
      suggestions_length: creatorResult.suggestions_length,
      emotional_overview_length: creatorResult.emotional_overview_length,
      key_moments_length: creatorResult.key_moments_length,
      recurring_themes_length: creatorResult.recurring_themes_length,
      progress_and_growth_length: creatorResult.progress_and_growth_length,
      has_name: creatorResult.has_name,
      has_avatar: creatorResult.has_avatar,
      has_location: creatorResult.has_location,
      has_birthday: creatorResult.has_birthday,
      has_gender: creatorResult.has_gender,
      nudging_occurrence: creatorResult.nudging_occurrence,
      goal: creatorResult.goal,
      connect_to: creatorResult.connect_to,
      personality: creatorResult.personality,
      tone: creatorResult.tone,
      friend_summary_count: friendIds.length,
    },
    friendSummaries: friendResults,
  };
};

/**
 * Firestore trigger function that runs when a new update is created.
 *
 * @param event - The Firestore event object containing the document data
 */
export const onUpdateCreated = async (
  event: FirestoreEvent<
    QueryDocumentSnapshot | undefined,
    {
      id: string;
    }
  >,
): Promise<void> => {
  if (!event.data) {
    logger.error('No data in update event');
    return;
  }

  logger.info(`Processing new update: ${event.data.id}`);

  // Get the update data directly from the event
  const updateData = event.data.data() || {};

  // Add the document ID to the update data
  updateData[UpdateFields.ID] = event.data.id;

  // Check if the update has the required fields
  if (!updateData || Object.keys(updateData).length === 0) {
    logger.error(`Update ${updateData[UpdateFields.ID] || 'unknown'} has no data`);
    return;
  }

  // Initialize Firestore client
  const db = getFirestore();

  try {
    const { mainSummary, friendSummaries } = await processAllSummaries(db, updateData);
    logger.info(`Successfully processed update ${updateData[UpdateFields.ID] || 'unknown'}`);

    // Track all events at once
    const events = [
      {
        eventName: EventName.SUMMARY_CREATED,
        params: mainSummary,
      },
      ...friendSummaries.map((summary) => ({
        eventName: EventName.FRIEND_SUMMARY_CREATED,
        params: summary,
      })),
    ];

    trackApiEvents(events, updateData[UpdateFields.CREATED_BY]);

    logger.info(`Tracked ${events.length} analytics events`);
  } catch (error) {
    logger.error(`Error processing update ${updateData[UpdateFields.ID] || 'unknown'}: ${error}`);
    // In a production environment, we would implement retry logic here
  }
};
