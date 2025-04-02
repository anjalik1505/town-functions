import { getFirestore } from "firebase-admin/firestore";
import { Collections, ProfileFields } from "../models/constants";
import { getLogger } from "./logging-utils";

const logger = getLogger(__filename);

/**
 * Fetches profile data for a user.
 * 
 * @param userId - The ID of the user to fetch profile data for
 * @returns Profile data or null if not found
 */
export const fetchUserProfile = async (userId: string) => {
    const db = getFirestore();
    const profileDoc = await db.collection(Collections.PROFILES).doc(userId).get();

    if (!profileDoc.exists) {
        logger.warn(`Profile not found for user: ${userId}`);
        return null;
    }

    const profileData = profileDoc.data() || {};
    return {
        username: profileData[ProfileFields.USERNAME] || "",
        name: profileData[ProfileFields.NAME] || "",
        avatar: profileData[ProfileFields.AVATAR] || ""
    };
};

/**
 * Fetches profile data for multiple users in parallel.
 * 
 * @param userIds - Array of user IDs to fetch profile data for
 * @returns Map of user IDs to their profile data
 */
export const fetchUsersProfiles = async (userIds: string[]) => {
    const profiles = new Map<string, { username: string; name: string; avatar: string }>();
    const uniqueUserIds = Array.from(new Set(userIds));

    // Fetch profiles in parallel
    const profilePromises = uniqueUserIds.map(async (userId) => {
        const profile = await fetchUserProfile(userId);
        if (profile) {
            profiles.set(userId, profile);
        }
    });

    await Promise.all(profilePromises);
    return profiles;
};

/**
 * Enriches an object with profile data.
 * 
 * @param item - The item to enrich with profile data
 * @param profile - The profile data to add
 * @returns The enriched item
 */
export const enrichWithProfile = <T extends { username?: string; name?: string; avatar?: string }>(
    item: T,
    profile: { username: string; name: string; avatar: string } | null
): T => {
    if (!profile) {
        return item;
    }

    return {
        ...item,
        username: profile.username,
        name: profile.name,
        avatar: profile.avatar
    };
}; 