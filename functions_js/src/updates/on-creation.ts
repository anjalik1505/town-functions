import { getFirestore, QueryDocumentSnapshot, Timestamp } from "firebase-admin/firestore";
import { FirestoreEvent } from "firebase-functions/v2/firestore";
import { generateCreatorProfileFlow, generateFriendProfileFlow } from "../ai/flows";
import { Collections, Documents, InsightsFields, ProfileFields, UpdateFields, UserSummaryFields } from "../models/constants";
import { getLogger } from "../utils/logging-utils";

const logger = getLogger(__filename);

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

    // Get the creator's name or username
    const creatorProfileRef = db.collection(Collections.PROFILES).doc(creatorId);
    const creatorProfileDoc = await creatorProfileRef.get();

    let creatorName = "Friend";
    if (creatorProfileDoc.exists) {
        const creatorProfileData = creatorProfileDoc.data() || {};
        // Try to get name first, then username, then fall back to "Friend"
        creatorName = creatorProfileData[ProfileFields.NAME] ||
            creatorProfileData[ProfileFields.USERNAME] ||
            "Friend";
    } else {
        logger.warn(`Creator profile not found: ${creatorId}`);
    }

    // Use the friend profile flow to generate summary and suggestions
    const result = await generateFriendProfileFlow({
        existingSummary,
        existingSuggestions,
        updateContent,
        sentiment,
        creatorName
    });

    // Prepare the summary document
    const now = Timestamp.now();
    const summaryUpdateData: Record<string, any> = {
        [UserSummaryFields.CREATOR_ID]: creatorId,
        [UserSummaryFields.TARGET_ID]: targetId,
        [UserSummaryFields.SUMMARY]: result.summary,
        [UserSummaryFields.SUGGESTIONS]: result.suggestions,
        [UserSummaryFields.LAST_UPDATE_ID]: updateId,
        [UserSummaryFields.UPDATED_AT]: now,
        [UserSummaryFields.UPDATE_COUNT]: updateCount
    };

    // If this is a new summary, add created_at
    if (!summaryDoc.exists) {
        summaryUpdateData[UserSummaryFields.CREATED_AT] = now;
    }

    // Add to batch instead of writing immediately
    batch.set(summaryRef, summaryUpdateData, { merge: true });
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
    // Get the profile document
    const profileRef = db.collection(Collections.PROFILES).doc(creatorId);
    const profileDoc = await profileRef.get();

    if (!profileDoc.exists) {
        logger.warn(`Profile not found for user ${creatorId}`);
        return;
    }

    // Extract data from the profile
    const profileData = profileDoc.data() || {};
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

    // Use the creator profile flow to generate insights
    const result = await generateCreatorProfileFlow({
        existingSummary,
        existingSuggestions,
        existingInsights: {
            emotional_overview: existingInsights[InsightsFields.EMOTIONAL_OVERVIEW] || "",
            key_moments: existingInsights[InsightsFields.KEY_MOMENTS] || "",
            recurring_themes: existingInsights[InsightsFields.RECURRING_THEMES] || "",
            progress_and_growth: existingInsights[InsightsFields.PROGRESS_AND_GROWTH] || ""
        },
        updateContent,
        sentiment
    });

    // Update the profile
    const profileUpdate = {
        [ProfileFields.SUMMARY]: result.summary,
        [ProfileFields.SUGGESTIONS]: result.suggestions,
        [ProfileFields.LAST_UPDATE_ID]: updateId,
        [ProfileFields.UPDATED_AT]: Timestamp.now()
    };

    // Add profile update to batch
    batch.update(profileRef, profileUpdate);
    logger.info(`Added profile update for user ${creatorId} to batch`);

    // Update or create insights document
    const insightsData = {
        [InsightsFields.EMOTIONAL_OVERVIEW]: result.emotional_overview,
        [InsightsFields.KEY_MOMENTS]: result.key_moments,
        [InsightsFields.RECURRING_THEMES]: result.recurring_themes,
        [InsightsFields.PROGRESS_AND_GROWTH]: result.progress_and_growth
    };

    const insightsRef = insightsDoc
        ? insightsDoc.ref
        : profileRef.collection(Collections.INSIGHTS).doc(Documents.DEFAULT_INSIGHTS);

    // Add insights update to batch
    batch.set(insightsRef, insightsData, { merge: true });
    logger.info(`Added insights update for user ${creatorId} to batch`);
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