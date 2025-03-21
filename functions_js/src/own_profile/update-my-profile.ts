import { Request, Response } from "express";
import { getFirestore, QueryDocumentSnapshot, Timestamp, WhereFilterOp } from "firebase-admin/firestore";
import { Collections, FriendshipFields, GroupFields, InsightsFields, InvitationFields, ProfileFields, QueryOperators } from "../models/constants";
import { ProfileResponse } from "../models/data-models";
import { getLogger } from "../utils/logging_utils";
import { formatTimestamp } from "../utils/timestamp_utils";

const logger = getLogger(__filename);

/**
 * Updates the authenticated user's profile information.
 * 
 * This function:
 * 1. Checks if a profile exists for the authenticated user
 * 2. Updates the profile with the provided data
 * 3. If username, name, or avatar changes, updates these fields in related collections:
 *    - Invitations
 *    - Friendships (both as sender and receiver)
 *    - Groups (in member_profiles)
 * 
 * @param req - The Express request object containing:
 *              - userId: The authenticated user's ID (attached by authentication middleware)
 *              - validated_params: Profile data that can include:
 *                - username: Optional updated username
 *                - name: Optional updated display name
 *                - avatar: Optional updated avatar URL
 *                - location: Optional updated location information
 *                - birthday: Optional updated birthday in ISO format
 *                - notification_settings: Optional updated list of notification preferences
 * @param res - The Express response object
 * 
 * @returns A ProfileResponse containing the updated profile information
 * 
 * @throws 404: Profile not found
 */
export const updateProfile = async (req: Request, res: Response) => {
    const currentUserId = req.userId;
    logger.info(`Starting update_profile operation for user ID: ${currentUserId}`);

    const db = getFirestore();
    const profileData = req.validated_params;

    // Check if profile exists
    const profileRef = db.collection(Collections.PROFILES).doc(currentUserId);
    const profileDoc = await profileRef.get();

    if (!profileDoc.exists) {
        logger.warn(`Profile not found for user ${currentUserId}`);
        return res.status(404).json({
            code: 404,
            name: "Not Found",
            description: "Profile not found"
        });
    }

    // Get current profile data
    const currentProfileData = profileDoc.data() || {};
    logger.info(`Retrieved current profile data for user ${currentUserId}`);

    // Check if username, name, or avatar has changed
    const usernameChanged = profileData.username !== undefined &&
        profileData.username !== currentProfileData[ProfileFields.USERNAME];

    const nameChanged = profileData.name !== undefined &&
        profileData.name !== currentProfileData[ProfileFields.NAME];

    const avatarChanged = profileData.avatar !== undefined &&
        profileData.avatar !== currentProfileData[ProfileFields.AVATAR];

    // Prepare update data
    const profileUpdates: Record<string, any> = {};

    // Only update fields that are provided in the request
    if (profileData.username !== undefined) {
        profileUpdates[ProfileFields.USERNAME] = profileData.username;
    }
    if (profileData.name !== undefined) {
        profileUpdates[ProfileFields.NAME] = profileData.name;
    }
    if (profileData.avatar !== undefined) {
        profileUpdates[ProfileFields.AVATAR] = profileData.avatar;
    }
    if (profileData.location !== undefined) {
        profileUpdates[ProfileFields.LOCATION] = profileData.location;
    }
    if (profileData.birthday !== undefined) {
        profileUpdates[ProfileFields.BIRTHDAY] = profileData.birthday;
    }
    if (profileData.notification_settings !== undefined) {
        profileUpdates[ProfileFields.NOTIFICATION_SETTINGS] = profileData.notification_settings;
    }

    // Create a batch for all updates
    const batch = db.batch();

    // Update the profile in the batch
    if (Object.keys(profileUpdates).length > 0) {
        profileUpdates[ProfileFields.UPDATED_AT] = Timestamp.now();
        batch.update(profileRef, profileUpdates);
        logger.info(`Added profile update to batch for user ${currentUserId}`);
    }

    // If username, name, or avatar changed, update references in other collections
    if (usernameChanged || nameChanged || avatarChanged) {
        logger.info(`Updating username/name/avatar references for user ${currentUserId}`);

        // 1. Update all invitations created by this user
        const invitationsQuery = db.collection(Collections.INVITATIONS)
            .where(InvitationFields.SENDER_ID, QueryOperators.EQUALS, currentUserId);

        for await (const doc of invitationsQuery.stream()) {
            const invitationDoc = doc as unknown as QueryDocumentSnapshot;
            const invitationUpdates: Record<string, any> = {};

            if (usernameChanged) {
                invitationUpdates[InvitationFields.USERNAME] = profileUpdates[ProfileFields.USERNAME];
            }
            if (nameChanged) {
                invitationUpdates[InvitationFields.NAME] = profileUpdates[ProfileFields.NAME];
            }
            if (avatarChanged) {
                invitationUpdates[InvitationFields.AVATAR] = profileUpdates[ProfileFields.AVATAR];
            }

            if (Object.keys(invitationUpdates).length > 0) {
                batch.update(invitationDoc.ref, invitationUpdates);
            }
        }

        // 2. Update friendships where user is sender
        const friendshipsAsSenderQuery = db.collection(Collections.FRIENDSHIPS)
            .where(FriendshipFields.SENDER_ID, QueryOperators.EQUALS, currentUserId);

        for await (const doc of friendshipsAsSenderQuery.stream()) {
            const friendshipDoc = doc as unknown as QueryDocumentSnapshot;
            const friendshipUpdates: Record<string, any> = {};

            if (usernameChanged) {
                friendshipUpdates[FriendshipFields.SENDER_USERNAME] = profileUpdates[ProfileFields.USERNAME];
            }
            if (nameChanged) {
                friendshipUpdates[FriendshipFields.SENDER_NAME] = profileUpdates[ProfileFields.NAME];
            }
            if (avatarChanged) {
                friendshipUpdates[FriendshipFields.SENDER_AVATAR] = profileUpdates[ProfileFields.AVATAR];
            }

            if (Object.keys(friendshipUpdates).length > 0) {
                batch.update(friendshipDoc.ref, friendshipUpdates);
            }
        }

        // 3. Update friendships where user is receiver
        const friendshipsAsReceiverQuery = db.collection(Collections.FRIENDSHIPS)
            .where(FriendshipFields.RECEIVER_ID, QueryOperators.EQUALS, currentUserId);

        for await (const doc of friendshipsAsReceiverQuery.stream()) {
            const friendshipDoc = doc as unknown as QueryDocumentSnapshot;
            const friendshipUpdates: Record<string, any> = {};

            if (usernameChanged) {
                friendshipUpdates[FriendshipFields.RECEIVER_USERNAME] = profileUpdates[ProfileFields.USERNAME];
            }
            if (nameChanged) {
                friendshipUpdates[FriendshipFields.RECEIVER_NAME] = profileUpdates[ProfileFields.NAME];
            }
            if (avatarChanged) {
                friendshipUpdates[FriendshipFields.RECEIVER_AVATAR] = profileUpdates[ProfileFields.AVATAR];
            }

            if (Object.keys(friendshipUpdates).length > 0) {
                batch.update(friendshipDoc.ref, friendshipUpdates);
            }
        }

        // 4. Update groups where user is a member
        const groupsQuery = db.collection(Collections.GROUPS)
            .where(GroupFields.MEMBERS, QueryOperators.ARRAY_CONTAINS as WhereFilterOp, currentUserId);

        for await (const doc of groupsQuery.stream()) {
            const groupDoc = doc as unknown as QueryDocumentSnapshot;
            const groupData = groupDoc.data();
            const memberProfiles = groupData[GroupFields.MEMBER_PROFILES] || [];

            // Find and update the user's profile in member_profiles array
            for (let i = 0; i < memberProfiles.length; i++) {
                const memberProfile = memberProfiles[i];
                if (memberProfile[ProfileFields.USER_ID] === currentUserId) {
                    if (usernameChanged) {
                        batch.update(groupDoc.ref, {
                            [`${GroupFields.MEMBER_PROFILES}.${i}.${ProfileFields.USERNAME}`]: profileUpdates[ProfileFields.USERNAME]
                        });
                    }
                    if (nameChanged) {
                        batch.update(groupDoc.ref, {
                            [`${GroupFields.MEMBER_PROFILES}.${i}.${ProfileFields.NAME}`]: profileUpdates[ProfileFields.NAME]
                        });
                    }
                    if (avatarChanged) {
                        batch.update(groupDoc.ref, {
                            [`${GroupFields.MEMBER_PROFILES}.${i}.${ProfileFields.AVATAR}`]: profileUpdates[ProfileFields.AVATAR]
                        });
                    }
                    break;
                }
            }
        }

        // After all reference updates
        logger.info(`Committed batch updates for user ${currentUserId}`);
    }

    // Commit all the updates in a single atomic operation
    if (Object.keys(profileUpdates).length > 0 || usernameChanged || nameChanged || avatarChanged) {
        await batch.commit();
    }

    // Get the updated profile data
    const updatedProfileDoc = await profileRef.get();
    const updatedProfileData = updatedProfileDoc.data() || {};

    // Get insights data
    const insightsSnapshot = await profileRef.collection(Collections.INSIGHTS).limit(1).get();
    const insightsDoc = insightsSnapshot.docs[0];
    const insightsData = insightsDoc?.data() || {};

    // Format updated_at timestamp - Firestore Timestamp to ISO string
    // This matches the Python datetime.isoformat() behavior
    const updatedAt = updatedProfileData[ProfileFields.UPDATED_AT] ? formatTimestamp(updatedProfileData[ProfileFields.UPDATED_AT]) : "";

    // Construct and return the profile response
    const response: ProfileResponse = {
        user_id: currentUserId,
        username: updatedProfileData[ProfileFields.USERNAME] || "",
        name: updatedProfileData[ProfileFields.NAME] || "",
        avatar: updatedProfileData[ProfileFields.AVATAR] || "",
        location: updatedProfileData[ProfileFields.LOCATION] || "",
        birthday: updatedProfileData[ProfileFields.BIRTHDAY] || "",
        notification_settings: updatedProfileData[ProfileFields.NOTIFICATION_SETTINGS] || [],
        summary: updatedProfileData[ProfileFields.SUMMARY] || "",
        suggestions: updatedProfileData[ProfileFields.SUGGESTIONS] || "",
        updated_at: updatedAt,
        insights: {
            emotional_overview: insightsData[InsightsFields.EMOTIONAL_OVERVIEW] || "",
            key_moments: insightsData[InsightsFields.KEY_MOMENTS] || "",
            recurring_themes: insightsData[InsightsFields.RECURRING_THEMES] || "",
            progress_and_growth: insightsData[InsightsFields.PROGRESS_AND_GROWTH] || ""
        }
    };

    return res.json(response);
}; 