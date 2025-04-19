import {getFirestore} from "firebase-admin/firestore";
import {Collections} from "../models/constants";
import {ReactionGroup} from "../models/data-models";
import {getLogger} from "./logging-utils";

const logger = getLogger(__filename);

/**
 * Fetches and processes reactions for an update.
 *
 * @param updateId - The ID of the update to fetch reactions for
 * @returns Map of reaction groups by type
 */
export const fetchUpdateReactions = async (updateId: string): Promise<ReactionGroup[]> => {
  const db = getFirestore();
  try {
    const reactionsSnapshot = await db.collection(Collections.UPDATES)
      .doc(updateId)
      .collection(Collections.REACTIONS)
      .get();

    const reactions: ReactionGroup[] = [];
    const reactionsByType = new Map<string, { count: number; id: string }>();

    reactionsSnapshot.docs.forEach(doc => {
      const reactionData = doc.data();
      const type = reactionData.type;
      const current = reactionsByType.get(type) || {count: 0, id: doc.id};
      reactionsByType.set(type, {count: current.count + 1, id: doc.id});
    });

    reactionsByType.forEach((data, type) => {
      reactions.push({type, count: data.count, reaction_id: data.id});
    });

    return reactions;
  } catch (error) {
    logger.error(`Error fetching reactions for update ${updateId}: ${error}`);
    return [];
  }
};

/**
 * Fetches and processes reactions for multiple updates in parallel.
 *
 * @param updateIds - Array of update IDs to fetch reactions for
 * @returns Map of update IDs to their reaction groups
 */
export const fetchUpdatesReactions = async (updateIds: string[]): Promise<Map<string, ReactionGroup[]>> => {
  const reactionsMap = new Map<string, ReactionGroup[]>();

  // Fetch reactions for all updates in parallel
  const reactionPromises = updateIds.map(async (updateId) => {
    const reactions = await fetchUpdateReactions(updateId);
    reactionsMap.set(updateId, reactions);
  });

  await Promise.all(reactionPromises);
  return reactionsMap;
}; 