import { getFirestore, QueryDocumentSnapshot } from "firebase-admin/firestore";
import { Collections, FeedFields, UpdateFields } from "../models/constants";
import { EnrichedUpdate, Update } from "../models/data-models";
import { ForbiddenError, NotFoundError } from "./errors";
import { getLogger } from "./logging-utils";
import { formatTimestamp } from "./timestamp-utils";
import { createFriendVisibilityIdentifier } from "./visibility-utils";

const logger = getLogger(__filename);

/**
 * Format an update document into a standard Update object
 * @param updateId The ID of the update
 * @param updateData The update document data
 * @param createdBy The ID of the user who created the update
 * @param reactions Optional reactions for the update
 * @returns A formatted Update object
 */
export const formatUpdate = (
    updateId: string,
    updateData: FirebaseFirestore.DocumentData,
    createdBy: string,
    reactions: any[] = []
): Update => {
    return {
        update_id: updateId,
        created_by: createdBy,
        content: updateData[UpdateFields.CONTENT] || "",
        group_ids: updateData[UpdateFields.GROUP_IDS] || [],
        friend_ids: updateData[UpdateFields.FRIEND_IDS] || [],
        sentiment: updateData[UpdateFields.SENTIMENT] || "",
        created_at: formatTimestamp(updateData[UpdateFields.CREATED_AT]),
        comment_count: updateData.comment_count || 0,
        reaction_count: updateData.reaction_count || 0,
        reactions: reactions
    };
};

/**
 * Format an update document into an EnrichedUpdate object with user profile information
 * @param updateId The ID of the update
 * @param updateData The update document data
 * @param createdBy The ID of the user who created the update
 * @param reactions Optional reactions for the update
 * @param profile Optional profile data for the creator
 * @returns A formatted EnrichedUpdate object
 */
export const formatEnrichedUpdate = (
    updateId: string,
    updateData: FirebaseFirestore.DocumentData,
    createdBy: string,
    reactions: any[] = [],
    profile: { username: string; name: string; avatar: string } | null = null
): EnrichedUpdate => {
    const update = formatUpdate(updateId, updateData, createdBy, reactions);

    // Create a base object with the update properties
    const enrichedUpdate = {
        ...update,
        username: profile?.username || "",
        name: profile?.name || "",
        avatar: profile?.avatar || ""
    };

    return enrichedUpdate;
};

/**
 * Process feed items and create update objects
 * @param feedDocs Array of feed document snapshots
 * @param updateMap Map of update IDs to update data
 * @param reactionsMap Map of update IDs to reactions
 * @param currentUserId The ID of the current user
 * @returns Array of formatted Update objects
 */
export const processFeedItems = (
    feedDocs: QueryDocumentSnapshot[],
    updateMap: Map<string, FirebaseFirestore.DocumentData>,
    reactionsMap: Map<string, any[]>,
    currentUserId: string
): Update[] => {
    return feedDocs
        .map(feedItem => {
            const feedData = feedItem.data();
            const updateId = feedData[FeedFields.UPDATE_ID];
            const updateData = updateMap.get(updateId);

            if (!updateData) {
                logger.warn(`Missing update data for feed item ${feedItem.id}`);
                return null;
            }

            return formatUpdate(
                updateId,
                updateData,
                currentUserId,
                reactionsMap.get(updateId) || []
            );
        })
        .filter((update): update is Update => update !== null);
};

/**
 * Process feed items and create enriched update objects with user profile information
 * @param feedDocs Array of feed document snapshots
 * @param updateMap Map of update IDs to update data
 * @param reactionsMap Map of update IDs to reactions
 * @param profiles Map of user IDs to profile data
 * @returns Array of formatted EnrichedUpdate objects
 */
export const processEnrichedFeedItems = (
    feedDocs: QueryDocumentSnapshot[],
    updateMap: Map<string, FirebaseFirestore.DocumentData>,
    reactionsMap: Map<string, any[]>,
    profiles: Map<string, { username: string; name: string; avatar: string }>
): EnrichedUpdate[] => {
    return feedDocs
        .map(feedItem => {
            const feedData = feedItem.data();
            const updateId = feedData[FeedFields.UPDATE_ID];
            const updateData = updateMap.get(updateId);
            const createdBy = feedData[FeedFields.CREATED_BY];

            if (!updateData) {
                logger.warn(`Missing update data for feed item ${feedItem.id}`);
                return null;
            }

            return formatEnrichedUpdate(
                updateId,
                updateData,
                createdBy,
                reactionsMap.get(updateId) || [],
                profiles.get(createdBy) || null
            );
        })
        .filter((update): update is EnrichedUpdate => update !== null);
};

/**
 * Fetch updates by their IDs
 * @param updateIds Array of update IDs to fetch
 * @returns Map of update IDs to update data
 */
export const fetchUpdatesByIds = async (updateIds: string[]): Promise<Map<string, FirebaseFirestore.DocumentData>> => {
    const db = getFirestore();

    // Fetch all updates in parallel
    const updatePromises = updateIds.map(updateId =>
        db.collection(Collections.UPDATES).doc(updateId).get()
    );
    const updateSnapshots = await Promise.all(updatePromises);

    // Create a map of update data for easy lookup
    return new Map(
        updateSnapshots
            .filter(doc => doc.exists)
            .map(doc => [doc.id, doc.data() as FirebaseFirestore.DocumentData])
    );
};

/**
 * Get an update document by ID
 * @param updateId The ID of the update
 * @returns The update document and data, or null if not found
 * @throws NotFoundError if the update doesn't exist
 */
export const getUpdateDoc = async (
    updateId: string
): Promise<{ ref: FirebaseFirestore.DocumentReference; data: FirebaseFirestore.DocumentData }> => {
    const db = getFirestore();
    const updateRef = db.collection(Collections.UPDATES).doc(updateId);
    const updateDoc = await updateRef.get();

    if (!updateDoc.exists) {
        logger.warn(`Update not found: ${updateId}`);
        throw new NotFoundError("Update not found");
    }

    return {
        ref: updateRef,
        data: updateDoc.data() || {}
    };
};

/**
 * Check if a user has access to an update
 * @param updateData The update document data
 * @param userId The ID of the user to check access for
 * @throws ForbiddenError if the user doesn't have access to the update
 */
export const hasUpdateAccess = (
    updateData: FirebaseFirestore.DocumentData,
    userId: string
): void => {
    const visibleTo = updateData[UpdateFields.VISIBLE_TO] || [];
    const friendVisibility = createFriendVisibilityIdentifier(userId);
    if (!visibleTo.includes(friendVisibility)) {
        throw new ForbiddenError("You don't have access to this update");
    }
};