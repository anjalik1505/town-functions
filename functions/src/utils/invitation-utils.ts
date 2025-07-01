import { getFirestore } from 'firebase-admin/firestore';
import { Collections, QueryOperators } from '../models/constants.js';
import { InvitationDoc, if_, invitationConverter } from '../models/firestore/invitation-doc.js';
import { getLogger } from './logging-utils.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Gets the current invitation link for a user
 * @param userId The ID of the user
 * @returns The invitation document reference and data, or null if no invitation exists
 */
export const getUserInvitationLink = async (userId: string) => {
  const db = getFirestore();

  // Query invitations where sender_id matches the user ID
  const invitationSnapshot = await db
    .collection(Collections.INVITATIONS)
    .withConverter(invitationConverter)
    .where(if_('sender_id'), QueryOperators.EQUALS, userId)
    .limit(1)
    .get();

  if (!invitationSnapshot.empty) {
    const invitationDoc = invitationSnapshot.docs[0];

    if (invitationDoc && invitationDoc.exists) {
      return {
        ref: invitationDoc.ref,
        doc: invitationDoc,
        data: invitationDoc.data() as InvitationDoc,
        isNew: false,
      };
    }
  }

  return null;
};

/**
 * Delete all invitations sent by or received by the user.
 *
 * @param userId - The ID of the user whose profile was deleted
 * @returns The number of invitations deleted
 */
export const deleteInvitation = async (userId: string): Promise<number> => {
  const db = getFirestore();
  const existingInvitation = await getUserInvitationLink(userId);

  let joinRequestsDeleted = 0;

  // Delete the invitation and all its subcollections if it exists
  if (existingInvitation) {
    const invitationRef = existingInvitation.ref;
    logger.info(
      `Found existing invitation with ID ${invitationRef.id} for user ${userId}, deleting it and all join requests`,
    );

    try {
      // Count the number of join requests first for analytics
      const joinRequestsSnapshot = await invitationRef.collection(Collections.JOIN_REQUESTS).count().get();
      joinRequestsDeleted = joinRequestsSnapshot.data().count;
    } catch (error) {
      logger.error(`Error counting join requests: ${error}`);
    }

    // Use recursiveDelete to delete the invitation document and all its subcollections
    await db.recursiveDelete(invitationRef);
    logger.info(
      `Deleted invitation with ID ${invitationRef.id} for user ${userId} and ${joinRequestsDeleted} join requests`,
    );
  }
  return joinRequestsDeleted;
};
