import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Collections, FriendshipFields, InvitationFields, QueryOperators, Status } from "../models/constants";
import { getLogger } from "../utils/logging-utils";

const MAX_COMBINED = 5;

const logger = getLogger(__filename);

/**
 * Creates a consistent friendship ID by sorting user IDs.
 * This ensures that the same friendship ID is generated regardless of which user is first.
 * 
 * @param userId1 - First user ID
 * @param userId2 - Second user ID
 * @returns A consistent friendship ID in the format "user1_user2" where user1 and user2 are sorted alphabetically
 */
export const createFriendshipId = (userId1: string, userId2: string): string => {
    const userIds = [userId1, userId2].sort();
    return `${userIds[0]}_${userIds[1]}`;
};

/**
 * Checks if a user has reached the combined limit of friends and active invitations
 * @param userId The user ID to check
 * @param excludeInvitationId Optional invitation ID to exclude from the count (for resending)
 * @returns An object containing the friend count, active invitation count, and whether the limit has been reached
 */
export const hasReachedCombinedLimit = async (userId: string, excludeInvitationId?: string): Promise<{ friendCount: number; activeInvitationCount: number; hasReachedLimit: boolean }> => {
    const db = getFirestore();
    const currentTime = Timestamp.now();

    // Get all friendships where the user is either the sender or receiver
    const friendshipsQuery = await db.collection(Collections.FRIENDSHIPS)
        .where(FriendshipFields.MEMBERS, QueryOperators.ARRAY_CONTAINS, userId)
        .get();

    const friendCount = friendshipsQuery.size;

    // Get all active invitations for the user
    const invitationsQuery = await db.collection(Collections.INVITATIONS)
        .where(InvitationFields.SENDER_ID, QueryOperators.EQUALS, userId)
        .get();

    let activeInvitationCount = 0;
    for (const doc of invitationsQuery.docs) {
        // Skip the excluded invitation if provided
        if (excludeInvitationId && doc.id === excludeInvitationId) {
            continue;
        }

        const invitationData = doc.data();
        const status = invitationData[InvitationFields.STATUS];
        const expiresAt = invitationData[InvitationFields.EXPIRES_AT] as Timestamp;

        if (status === Status.PENDING && expiresAt && expiresAt.toDate() > currentTime.toDate()) {
            activeInvitationCount++;
        }
    }

    const totalCount = friendCount + activeInvitationCount;
    logger.info(`User ${userId} has ${friendCount} friends and ${activeInvitationCount} active invitations (total: ${totalCount})`);
    return { friendCount, activeInvitationCount, hasReachedLimit: totalCount >= MAX_COMBINED };
};