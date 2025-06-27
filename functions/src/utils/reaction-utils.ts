import { getFirestore } from 'firebase-admin/firestore';
import { Collections, UpdateFields } from '../models/constants.js';
import { ReactionGroup } from '../models/data-models.js';
import { getLogger } from './logging-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Fetches and processes reactions for an update from the denormalized reaction_summary.
 *
 * @param updateId - The ID of the update to fetch reactions for
 * @returns Array of reaction groups by type
 */
export const fetchUpdateReactions = async (updateId: string): Promise<ReactionGroup[]> => {
  const db = getFirestore();
  try {
    const updateDoc = await db.collection(Collections.UPDATES).doc(updateId).get();

    if (!updateDoc.exists) {
      logger.warn(`Update ${updateId} not found`);
      return [];
    }

    const updateData = updateDoc.data();
    const reactionSummary = updateData?.[UpdateFields.REACTION_TYPES];

    // If no reaction_summary exists, return empty array
    if (!reactionSummary) {
      return [];
    }

    // Convert the by_type object to ReactionGroup array
    const reactions: ReactionGroup[] = Object.entries(reactionSummary)
      .map(([type, count]) => ({
        type,
        count: count as number,
        reaction_id: '', // reaction_id is no longer meaningful with denormalized data
      }))
      .filter((reaction) => reaction.count > 0); // Only include reactions with count > 0

    return reactions;
  } catch (error) {
    logger.error(`Error fetching reactions for update ${updateId}: ${error}`);
    return [];
  }
};

/**
 * Use fetchUpdateReactions for individual updates or access reaction_summary directly from update documents.
 *
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
