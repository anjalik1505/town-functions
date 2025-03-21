import { getFirestore, QueryDocumentSnapshot, Timestamp } from "firebase-admin/firestore";
import { FirestoreEvent } from "firebase-functions/v2/firestore";
import { Collections, Documents, InsightsFields, ProfileFields, UpdateFields, UserSummaryFields } from "../models/constants";
import { getLogger } from "../utils/logging_utils";

const logger = getLogger(__filename);

/**
 * Generate a summary using AI. This is a dummy implementation.
 * 
 * @param existingSummary - The existing summary text, if any
 * @param updateContent - The content of the new update
 * @param sentiment - The sentiment of the new update
 * @returns The updated summary text
 */
async function generateSummary(
    existingSummary: string | undefined,
    updateContent: string,
    sentiment: string
): Promise<string> {
    // TODO: Implement actual AI call to Gemini Flash Lite 2.0
    // This is a dummy implementation
    logger.info("Generating summary with AI");

    if (existingSummary) {
        return `${existingSummary}\nNew update: ${updateContent} (Sentiment: ${sentiment})`;
    } else {
        return `Summary started with: ${updateContent} (Sentiment: ${sentiment})`;
    }
}

/**
 * Generate suggestions using AI. This is a dummy implementation.
 * 
 * @param existingSuggestions - The existing suggestions text, if any
 * @param updateContent - The content of the new update
 * @param sentiment - The sentiment of the new update
 * @returns The updated suggestions text
 */
async function generateSuggestions(
    existingSuggestions: string | undefined,
    updateContent: string,
    sentiment: string
): Promise<string> {
    // TODO: Implement actual AI call to Gemini Flash Lite 2.0
    // This is a dummy implementation
    logger.info("Generating suggestions with AI");

    if (existingSuggestions) {
        return `${existingSuggestions}\nNew suggestion based on: ${updateContent}`;
    } else {
        return `Consider asking about: ${updateContent}`;
    }
}

/**
 * Generate insights using AI. This is a dummy implementation.
 * 
 * @param existingInsights - The existing insights data, if any
 * @param updateContent - The content of the new update
 * @param sentiment - The sentiment of the new update
 * @returns The updated insights data
 */
async function generateInsights(
    existingInsights: Record<string, string> | undefined,
    updateContent: string,
    sentiment: string
): Promise<Record<string, string>> {
    // TODO: Implement actual AI call to Gemini Flash Lite 2.0
    // This is a dummy implementation
    logger.info("Generating insights with AI");

    // Create default insights if none exist
    if (!existingInsights) {
        existingInsights = {
            [InsightsFields.EMOTIONAL_OVERVIEW]: "",
            [InsightsFields.KEY_MOMENTS]: "",
            [InsightsFields.RECURRING_THEMES]: "",
            [InsightsFields.PROGRESS_AND_GROWTH]: ""
        };
    }

    // Update the insights with new information
    return {
        [InsightsFields.EMOTIONAL_OVERVIEW]: `${existingInsights[InsightsFields.EMOTIONAL_OVERVIEW]}\nSentiment: ${sentiment}`,
        [InsightsFields.KEY_MOMENTS]: `${existingInsights[InsightsFields.KEY_MOMENTS]}\nNew moment: ${updateContent}`,
        [InsightsFields.RECURRING_THEMES]: existingInsights[InsightsFields.RECURRING_THEMES] || "Themes will be identified over time",
        [InsightsFields.PROGRESS_AND_GROWTH]: existingInsights[InsightsFields.PROGRESS_AND_GROWTH] || "Progress tracking will develop over time"
    };
}

/**
 * Process a summary for a specific friend.
 * 
 * @param db - Firestore client
 * @param updateData - The update document data
 * @param creatorId - The ID of the user who created the update
 * @param friendId - The ID of the friend to process the summary for
 * @param batch - Firestore write batch for atomic operations
 */
async function processFriendSummary(
    db: FirebaseFirestore.Firestore,
    updateData: Record<string, any>,
    creatorId: string,
    friendId: string,
    batch: FirebaseFirestore.WriteBatch
): Promise<void> {
    // Sort user IDs to create a consistent relationship ID
    const userIds = [creatorId, friendId].sort();
    const relationshipId = `${userIds[0]}_${userIds[1]}`;

    // Determine which user is the target (the friend who will see the summary)
    const targetId = friendId;

    // Get the existing summary document if it exists
    const summaryRef = db.collection(Collections.USER_SUMMARIES).doc(relationshipId);
    const summaryDoc = await summaryRef.get();

    // Extract data from the existing summary or initialize new data
    let existingSummary: string | undefined;
    let existingSuggestions: string | undefined;
    let updateCount: number;

    if (summaryDoc.exists) {
        const summaryData = summaryDoc.data() || {};
        existingSummary = summaryData[UserSummaryFields.SUMMARY];
        existingSuggestions = summaryData[UserSummaryFields.SUGGESTIONS];
        updateCount = (summaryData[UserSummaryFields.UPDATE_COUNT] || 0) + 1;
    } else {
        updateCount = 1;
    }

    // Extract update content and sentiment
    const updateContent = updateData[UpdateFields.CONTENT];
    const sentiment = updateData[UpdateFields.SENTIMENT];
    const updateId = updateData[UpdateFields.ID];

    // Generate summary and suggestions in parallel
    const [newSummary, newSuggestions] = await Promise.all([
        generateSummary(existingSummary, updateContent, sentiment),
        generateSuggestions(existingSuggestions, updateContent, sentiment)
    ]);

    // Prepare the summary document
    const now = Timestamp.now();
    const summaryData: Record<string, any> = {
        [UserSummaryFields.CREATOR_ID]: creatorId,
        [UserSummaryFields.TARGET_ID]: targetId,
        [UserSummaryFields.SUMMARY]: newSummary,
        [UserSummaryFields.SUGGESTIONS]: newSuggestions,
        [UserSummaryFields.LAST_UPDATE_ID]: updateId,
        [UserSummaryFields.UPDATED_AT]: now,
        [UserSummaryFields.UPDATE_COUNT]: updateCount
    };

    // If this is a new summary, add created_at
    if (!summaryDoc.exists) {
        summaryData[UserSummaryFields.CREATED_AT] = now;
    }

    // Add to batch instead of writing immediately
    batch.set(summaryRef, summaryData, { merge: true });
    logger.info(`Added summary update for relationship ${relationshipId} to batch`);
}

/**
 * Update the creator's own profile with summary, suggestions, and insights.
 * 
 * @param db - Firestore client
 * @param updateData - The update document data
 * @param creatorId - The ID of the user who created the update
 * @param batch - Firestore write batch for atomic operations
 */
async function updateCreatorProfile(
    db: FirebaseFirestore.Firestore,
    updateData: Record<string, any>,
    creatorId: string,
    batch: FirebaseFirestore.WriteBatch
): Promise<void> {
    // Get the creator's profile
    const profileRef = db.collection(Collections.PROFILES).doc(creatorId);
    const profileDoc = await profileRef.get();

    if (!profileDoc.exists) {
        logger.warn(`Creator profile not found: ${creatorId}`);
        return;
    }

    const profileData = profileDoc.data() || {};

    // Extract existing summary and suggestions
    const existingSummary = profileData[ProfileFields.SUMMARY];
    const existingSuggestions = profileData[ProfileFields.SUGGESTIONS];

    // Extract update content and sentiment
    const updateContent = updateData[UpdateFields.CONTENT];
    const sentiment = updateData[UpdateFields.SENTIMENT];
    const updateId = updateData[UpdateFields.ID];

    // Get insights data from the profile's insights subcollection
    const insightsSnapshot = await profileRef.collection(Collections.INSIGHTS).limit(1).get();
    const insightsDoc = insightsSnapshot.docs[0];
    const existingInsights = insightsDoc?.data() || {};

    // Generate summary, suggestions, and insights in parallel
    const [newSummary, newSuggestions, newInsights] = await Promise.all([
        generateSummary(existingSummary, updateContent, sentiment),
        generateSuggestions(existingSuggestions, updateContent, sentiment),
        generateInsights(existingInsights, updateContent, sentiment)
    ]);

    // Update the profile
    const now = Timestamp.now();
    const profileUpdates = {
        [ProfileFields.SUMMARY]: newSummary,
        [ProfileFields.SUGGESTIONS]: newSuggestions,
        [ProfileFields.LAST_UPDATE_ID]: updateId,
        [ProfileFields.UPDATED_AT]: now
    };

    // Add profile update to batch
    batch.update(profileRef, profileUpdates);
    logger.info(`Added profile update for creator ${creatorId} to batch`);

    // Update or create the insights document
    const insightsRef = profileRef.collection(Collections.INSIGHTS).doc(Documents.DEFAULT_INSIGHTS);
    batch.set(insightsRef, newInsights, { merge: true });
    logger.info(`Added insights update for creator ${creatorId} to batch`);
}

/**
 * Process summaries for all friends and the creator in parallel.
 * 
 * @param db - Firestore client
 * @param updateData - The update document data
 */
async function processAllSummaries(
    db: FirebaseFirestore.Firestore,
    updateData: Record<string, any>
): Promise<void> {
    // Get the creator ID and friend IDs
    const creatorId = updateData[UpdateFields.CREATED_BY];
    const friendIds = updateData[UpdateFields.FRIEND_IDS] || [];

    if (!creatorId) {
        logger.error("Update has no creator ID");
        return;
    }

    // Create a batch for atomic writes
    const batch = db.batch();

    // Create tasks for all friends and the creator
    const tasks = [];

    // Add task for updating the creator's profile
    tasks.push(updateCreatorProfile(db, updateData, creatorId, batch));

    // Add tasks for all friends
    for (const friendId of friendIds) {
        tasks.push(processFriendSummary(db, updateData, creatorId, friendId, batch));
    }

    // Run all tasks in parallel
    await Promise.all(tasks);

    // Commit the batch
    if (tasks.length > 0) {
        await batch.commit();
        logger.info(`Committed batch with ${tasks.length} summary updates`);
    }
}

/**
 * Firestore trigger function that runs when a new update is created.
 * 
 * @param event - The Firestore event object containing the document data
 */
export async function onUpdateCreated(event: FirestoreEvent<QueryDocumentSnapshot | undefined, { id: string }>): Promise<void> {
    if (!event.data) {
        logger.error("No data in update event");
        return;
    }

    logger.info(`Processing new update: ${event.data.id}`);

    // Get the update data directly from the event
    const updateData = event.data.data() || {};

    // Add the document ID to the update data
    updateData[UpdateFields.ID] = event.data.id;

    // Check if the update has the required fields
    if (!updateData || Object.keys(updateData).length === 0) {
        logger.error(`Update ${updateData[UpdateFields.ID] || "unknown"} has no data`);
        return;
    }

    // Initialize Firestore client
    const db = getFirestore();

    try {
        await processAllSummaries(db, updateData);
        logger.info(`Successfully processed update ${updateData[UpdateFields.ID] || "unknown"}`);
    } catch (error) {
        logger.error(`Error processing update ${updateData[UpdateFields.ID] || "unknown"}: ${error}`);
        // In a production environment, we would implement retry logic here
    }
} 