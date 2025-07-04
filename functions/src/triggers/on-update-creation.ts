import { QueryDocumentSnapshot, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { FirestoreEvent } from 'firebase-functions/v2/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { analyzeImagesFlow, generateCreatorProfileFlow } from '../ai/flows.js';
import { EventName, FriendSummaryEventParams, SummaryEventParams } from '../models/analytics-events.js';
import { Collections, Documents } from '../models/constants.js';
import { ProfileDoc, pf, profileConverter } from '../models/firestore/profile-doc.js';
import { UpdateDoc, uf } from '../models/firestore/update-doc.js';
import { trackApiEvents } from '../utils/analytics-utils.js';
import { getFriendDoc, upsertFriendDoc, type FriendDocUpdate } from '../utils/friendship-utils.js';
import { processImagesForPrompt } from '../utils/image-utils.js';
import { getLogger } from '../utils/logging-utils.js';
import {
  calculateAge,
  extractConnectToForAnalytics,
  extractGoalForAnalytics,
  extractNudgingOccurrence,
} from '../utils/profile-utils.js';
import { processFriendSummary } from '../utils/summary-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

// Define InsightsDoc interface (since it's not in a separate file)
interface InsightsDoc {
  emotional_overview: string;
  key_moments: string;
  recurring_themes: string;
  progress_and_growth: string;
}

const insightsConverter: FirebaseFirestore.FirestoreDataConverter<InsightsDoc> = {
  toFirestore: (i) => i,
  fromFirestore: (snap) => snap.data() as InsightsDoc,
};

const inf = <K extends keyof InsightsDoc>(k: K) => k;

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
  updateData: UpdateDoc,
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
  // Get the profile document with typed converter
  const profileRef = db.collection(Collections.PROFILES).doc(creatorId).withConverter(profileConverter);
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

  // Extract data from the profile - now typed
  const profileData = profileDoc.data();
  if (!profileData) {
    logger.error('Profile data is null');
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

  const existingSummary = profileData[pf('summary')];
  const existingSuggestions = profileData[pf('suggestions')];

  // Extract update content and sentiment
  const updateContent = updateData[uf('content')];
  const sentiment = updateData[uf('sentiment')];
  const updateId = updateData[uf('id')];

  // Get insight data from the profile's insight subcollection
  const insightsRef = profileRef.collection(Collections.INSIGHTS).withConverter(insightsConverter);
  const insightsSnapshot = await insightsRef.limit(1).get();
  const insightsDoc = insightsSnapshot.docs[0];
  const existingInsights = insightsDoc?.data() || ({} as Partial<InsightsDoc>);

  // Calculate age from the birthday
  const age = calculateAge(profileData[pf('birthday')] || '');

  // Use the creator profile flow to generate insights
  const result = await generateCreatorProfileFlow({
    existingSummary: existingSummary || '',
    existingSuggestions: existingSuggestions || '',
    existingEmotionalOverview: existingInsights[inf('emotional_overview')] || '',
    existingKeyMoments: existingInsights[inf('key_moments')] || '',
    existingRecurringThemes: existingInsights[inf('recurring_themes')] || '',
    existingProgressAndGrowth: existingInsights[inf('progress_and_growth')] || '',
    updateContent: updateContent || '',
    sentiment: sentiment || '',
    gender: profileData[pf('gender')] || 'unknown',
    location: profileData[pf('location')] || 'unknown',
    age: age,
    imageAnalysis: imageAnalysis,
  });

  // Update the profile
  const profileUpdate: Partial<ProfileDoc> = {
    [pf('summary')]: result.summary || '',
    [pf('suggestions')]: result.suggestions || '',
    [pf('last_update_id')]: updateId,
    [pf('updated_at')]: Timestamp.now(),
  };

  // Add profile update to batch
  batch.update(profileRef, profileUpdate);
  logger.info(`Added profile update for user ${creatorId} to batch`);

  // Update or create the insights document
  const insightsData: InsightsDoc = {
    [inf('emotional_overview')]: result.emotional_overview || '',
    [inf('key_moments')]: result.key_moments || '',
    [inf('recurring_themes')]: result.recurring_themes || '',
    [inf('progress_and_growth')]: result.progress_and_growth || '',
  };

  const insightDocRef = insightsDoc ? insightsDoc.ref : insightsRef.doc(Documents.DEFAULT_INSIGHTS);

  // Add insight update to batch
  batch.set(insightDocRef, insightsData, { merge: true });
  logger.info(`Added insights update for user ${creatorId} to batch`);

  return {
    summary_length: (result.summary || '').length,
    suggestions_length: (result.suggestions || '').length,
    emotional_overview_length: (result.emotional_overview || '').length,
    key_moments_length: (result.key_moments || '').length,
    recurring_themes_length: (result.recurring_themes || '').length,
    progress_and_growth_length: (result.progress_and_growth || '').length,
    has_name: !!profileData[pf('name')],
    has_avatar: !!profileData[pf('avatar')],
    has_location: !!profileData[pf('location')],
    has_birthday: !!profileData[pf('birthday')],
    has_gender: !!profileData[pf('gender')],
    nudging_occurrence: extractNudgingOccurrence(profileData),
    goal: extractGoalForAnalytics(profileData),
    connect_to: extractConnectToForAnalytics(profileData),
    personality: profileData[pf('personality')] || '',
    tone: profileData[pf('tone')] || '',
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
  updateData: UpdateDoc,
): Promise<{
  mainSummary: SummaryEventParams;
  friendSummaries: FriendSummaryEventParams[];
}> => {
  const creatorId = updateData[uf('created_by')];
  const friendIds = updateData[uf('friend_ids')] || [];

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
  const imagePaths = updateData[uf('image_paths')] || [];
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

  // Update friend documents with emoji
  const emoji = updateData[uf('emoji')];
  if (emoji) {
    const friendshipUpdateTasks = friendIds.map(async (friendId) => {
      // Check if they are friends using the new system and get friend data
      const friendDocResult = await getFriendDoc(creatorId, friendId);

      if (friendDocResult) {
        const friendDocUpdate: FriendDocUpdate = {
          last_update_emoji: emoji,
          last_update_at: updateData[uf('created_at')],
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
      update_length: (updateData[uf('content')] || '').length,
      update_sentiment: updateData[uf('sentiment')] || '',
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
  const updateData = event.data.data() as UpdateDoc;

  // Add the document ID to the update data
  updateData[uf('id')] = event.data.id;

  // Check if the update has the required fields
  if (!updateData || Object.keys(updateData).length === 0) {
    logger.error(`Update ${updateData[uf('id')] || 'unknown'} has no data`);
    return;
  }

  // Initialize Firestore client
  const db = getFirestore();

  try {
    const { mainSummary, friendSummaries } = await processAllSummaries(db, updateData);
    logger.info(`Successfully processed update ${updateData[uf('id')] || 'unknown'}`);

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

    trackApiEvents(events, updateData[uf('created_by')]);

    logger.info(`Tracked ${events.length} analytics events`);
  } catch (error) {
    logger.error(`Error processing update ${updateData[uf('id')] || 'unknown'}: ${error}`);
    // In a production environment, we would implement retry logic here
  }
};
