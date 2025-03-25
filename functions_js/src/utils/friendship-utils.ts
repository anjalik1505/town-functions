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