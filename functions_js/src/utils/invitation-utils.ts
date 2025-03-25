import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { Collections, FriendshipFields, InvitationFields, Status } from "../models/constants";

const MAX_INVITATIONS = 5;
const MAX_FRIENDS = 5;

/**
 * Checks if a user has reached the maximum number of active invitations
 * @param userId The user ID to check
 * @returns true if the user has reached the limit, false otherwise
 */
export const hasReachedInvitationLimit = async (userId: string): Promise<boolean> => {
    const db = getFirestore();
    const currentTime = Timestamp.now();

    const invitationsQuery = await db.collection(Collections.INVITATIONS)
        .where(InvitationFields.SENDER_ID, "==", userId)
        .get();

    let activeCount = 0;

    for (const doc of invitationsQuery.docs) {
        const invitationData = doc.data();
        const status = invitationData[InvitationFields.STATUS];
        const expiresAt = invitationData[InvitationFields.EXPIRES_AT] as Timestamp;

        if (status === Status.PENDING && expiresAt && expiresAt.toDate() > currentTime.toDate()) {
            activeCount++;
        }
    }

    return activeCount >= MAX_INVITATIONS;
};

/**
 * Checks if a user has reached the maximum number of friends
 * @param userId The user ID to check
 * @returns true if the user has reached the limit, false otherwise
 */
export const hasReachedFriendLimit = async (userId: string): Promise<boolean> => {
    const db = getFirestore();

    // Get all friendships where the user is either the sender or receiver
    const friendshipsQuery = await db.collection(Collections.FRIENDSHIPS)
        .where(FriendshipFields.MEMBERS, "array-contains", userId)
        .get();

    return friendshipsQuery.size >= MAX_FRIENDS;
}; 