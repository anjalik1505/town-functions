import { ProfileDAO } from '../dao/profile-dao.js';
import { FriendshipDAO } from '../dao/friendship-dao.js';
import { PhoneDAO } from '../dao/phone-dao.js';
import { ProfileDoc } from '../models/firestore/profile-doc.js';
import {
  BaseUser,
  ProfileResponse,
  FriendProfileResponse,
  QuestionResponse,
  PhoneLookupResponse,
} from '../models/data-models.js';
import { NotFoundError, ConflictError, ForbiddenError, BadRequestError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { trackApiEvent } from '../utils/analytics-utils.js';
import { EventName } from '../models/analytics-events.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';
import { generateQuestionFlow, generateFriendProfileFlow } from '../ai/flows.js';
import { Collections, NotificationTypes } from '../models/constants.js';
import { sendNotification } from '../utils/notification-utils.js';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { nudgeConverter, deviceConverter } from '../models/firestore/index.js';
import { FieldValue } from 'firebase-admin/firestore';
import { FriendDoc } from '../models/firestore/friend-doc.js';
import { NotificationSetting, Personality, Tone, NudgingSettings } from '../models/firestore/profile-doc.js';

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

const NUDGE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour in milliseconds;

/**
 * Service layer for Profile-related operations
 * Coordinates between ProfileDAO, FriendshipDAO, and PhoneDAO
 */
export class ProfileService {
  private profileDAO: ProfileDAO;
  private friendshipDAO: FriendshipDAO;
  private phoneDAO: PhoneDAO;
  private db: FirebaseFirestore.Firestore;

  constructor() {
    this.profileDAO = new ProfileDAO();
    this.friendshipDAO = new FriendshipDAO();
    this.phoneDAO = new PhoneDAO();
    this.db = getFirestore();
  }

  /**
   * Creates a new user profile with phone validation and analytics tracking
   */
  async createProfile(
    userId: string,
    data: {
      username: string;
      name?: string;
      avatar?: string;
      location?: string;
      birthday?: string;
      notification_settings?: NotificationSetting[];
      nudging_settings?: NudgingSettings;
      gender?: string;
      goal?: string;
      connect_to?: string;
      personality?: Personality;
      tone?: Tone;
      phone_number?: string;
    },
  ): Promise<void> {
    logger.info(`Creating profile for user ${userId}`, { data });

    // Validate phone uniqueness if provided
    if (data.phone_number) {
      const phoneExists = await this.phoneDAO.exists(data.phone_number);
      if (phoneExists) {
        throw new ConflictError('Phone number is already associated with another account');
      }
    }

    // Create profile with default values
    const profileData: Partial<ProfileDoc> = {
      user_id: userId,
      username: data.username,
      name: data.name || '',
      avatar: data.avatar || '',
      location: data.location || '',
      birthday: data.birthday || '',
      notification_settings: (data.notification_settings || []) as NotificationSetting[],
      nudging_settings: data.nudging_settings || { occurrence: 'never' },
      gender: data.gender || '',
      goal: data.goal || '',
      connect_to: data.connect_to || '',
      personality: (data.personality || '') as Personality,
      tone: (data.tone || 'light_and_casual') as Tone,
      phone_number: data.phone_number || '',
      group_ids: [],
      summary: '',
      suggestions: '',
      last_update_id: undefined,
      timezone: 'UTC',
      friends_to_cleanup: [],
      friend_count: 0,
    };

    // Create profile with insights in transaction
    await this.profileDAO.create(userId, profileData);

    // Create phone mapping if phone number provided
    if (data.phone_number) {
      await this.phoneDAO.create(data.phone_number, {
        user_id: userId,
        username: data.username,
        name: data.name || '',
        avatar: data.avatar || '',
      });
    }

    // Track analytics
    const analyticsData = this.profileDAO.extractAnalyticsData(profileData as ProfileDoc);
    trackApiEvent(EventName.PROFILE_CREATED, userId, analyticsData);

    logger.info(`Successfully created profile for user ${userId}`);
  }

  /**
   * Gets a user's profile with formatted timestamps
   */
  async getProfile(userId: string): Promise<ProfileResponse> {
    logger.info(`Getting profile for user ${userId}`);

    const profileData = await this.profileDAO.getById(userId);
    if (!profileData) {
      throw new NotFoundError('Profile not found');
    }

    // Format response with proper timestamp formatting
    const response: ProfileResponse = {
      user_id: profileData.user_id,
      username: profileData.username,
      name: profileData.name,
      avatar: profileData.avatar,
      location: profileData.location,
      birthday: profileData.birthday,
      notification_settings: profileData.notification_settings,
      nudging_settings: profileData.nudging_settings,
      gender: profileData.gender,
      summary: profileData.summary,
      insights: profileData.insights || {
        emotional_overview: '',
        key_moments: '',
        recurring_themes: '',
        progress_and_growth: '',
      },
      suggestions: profileData.suggestions,
      updated_at: formatTimestamp(profileData.updated_at),
      timezone: profileData.timezone,
      tone: profileData.tone,
      phone_number: profileData.phone_number,
    };

    logger.info(`Successfully retrieved profile for user ${userId}`);
    return response;
  }

  /**
   * Updates a user's profile with phone conflict checking
   */
  async updateProfile(
    userId: string,
    data: {
      username?: string;
      name?: string;
      avatar?: string;
      location?: string;
      birthday?: string;
      notification_settings?: NotificationSetting[];
      nudging_settings?: NudgingSettings;
      gender?: string;
      goal?: string;
      connect_to?: string;
      personality?: Personality;
      tone?: Tone;
      phone_number?: string;
    },
  ): Promise<void> {
    logger.info(`Updating profile for user ${userId}`, { data });

    const existingProfile = await this.profileDAO.getById(userId);
    if (!existingProfile) {
      throw new NotFoundError('Profile not found');
    }

    // Check phone number conflicts
    if (data.phone_number && data.phone_number !== existingProfile.phone_number) {
      const phoneExists = await this.phoneDAO.exists(data.phone_number);
      if (phoneExists) {
        throw new ConflictError('Phone number is already associated with another account');
      }
    }

    // Update profile
    const updateData: Partial<ProfileDoc> = {
      ...data,
      updated_at: FieldValue.serverTimestamp() as Timestamp,
    } as Partial<ProfileDoc>;

    await this.profileDAO.update(userId, updateData);

    // Handle phone number changes
    if (data.phone_number !== undefined && data.phone_number !== existingProfile.phone_number) {
      await this.phoneDAO.updateForUser(existingProfile.phone_number || null, data.phone_number, userId, {
        username: data.username || existingProfile.username,
        name: data.name || existingProfile.name,
        avatar: data.avatar || existingProfile.avatar,
      });
    }

    // Track analytics
    const analyticsData = this.profileDAO.extractAnalyticsData({ ...existingProfile, ...data } as ProfileDoc);
    trackApiEvent(EventName.PROFILE_UPDATED, userId, analyticsData);

    logger.info(`Successfully updated profile for user ${userId}`);
  }

  /**
   * Deletes a user's profile with cascade deletion
   */
  async deleteProfile(userId: string): Promise<void> {
    logger.info(`Deleting profile for user ${userId}`);

    const profile = await this.profileDAO.getById(userId);
    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    // Delete phone mapping if exists
    if (profile.phone_number) {
      await this.phoneDAO.delete(profile.phone_number);
    }

    // Delete profile (includes subcollections via ProfileDAO)
    await this.profileDAO.delete(userId);

    logger.info(`Successfully deleted profile for user ${userId}`);
  }

  /**
   * Gets a friend's profile with access validation
   */
  async getFriendProfile(currentUserId: string, targetUserId: string): Promise<FriendProfileResponse> {
    logger.info(`Getting friend profile: ${currentUserId} -> ${targetUserId}`);

    // Check if users are friends
    const areFriends = await this.friendshipDAO.areFriends(currentUserId, targetUserId);
    if (!areFriends) {
      throw new ForbiddenError('You must be friends with this user to view their profile');
    }

    const profileData = await this.profileDAO.getById(targetUserId);
    if (!profileData) {
      throw new NotFoundError('Profile not found');
    }

    // Generate friend summary if needed
    let summary = profileData.summary;
    let suggestions = profileData.suggestions;

    if (!summary || !suggestions) {
      try {
        const friendProfile = await generateFriendProfileFlow({
          existingSummary: summary,
          existingSuggestions: suggestions,
          updateContent: '',
          sentiment: '',
          friendName: profileData.name,
          friendGender: profileData.gender,
          friendLocation: profileData.location,
          friendAge: '',
          userName: '',
          userGender: '',
          userLocation: '',
          userAge: '',
        });
        summary = friendProfile.summary || summary;
        suggestions = friendProfile.suggestions || suggestions;
      } catch (error) {
        logger.error('Failed to generate friend profile', { error });
        // Continue with existing data
      }
    }

    const response: FriendProfileResponse = {
      user_id: profileData.user_id,
      username: profileData.username,
      name: profileData.name,
      avatar: profileData.avatar,
      location: profileData.location,
      birthday: profileData.birthday,
      gender: profileData.gender,
      summary,
      suggestions,
      updated_at: formatTimestamp(profileData.updated_at),
      timezone: profileData.timezone,
    };

    logger.info(`Successfully retrieved friend profile for ${targetUserId}`);
    return response;
  }

  /**
   * Updates user location
   */
  async updateLocation(userId: string, data: { location: string }): Promise<void> {
    logger.info(`Updating location for user ${userId}`, { data });
    await this.profileDAO.updateLocation(userId, data.location);
    logger.info(`Successfully updated location for user ${userId}`);
  }

  /**
   * Updates user timezone
   */
  async updateTimezone(userId: string, data: { timezone: string }): Promise<void> {
    logger.info(`Updating timezone for user ${userId}`, { data });
    await this.profileDAO.updateTimezone(userId, data.timezone);
    logger.info(`Successfully updated timezone for user ${userId}`);
  }

  /**
   * Generates a personalized question for the user using AI
   */
  async generateQuestion(userId: string): Promise<QuestionResponse> {
    logger.info(`Generating question for user ${userId}`);

    const profileData = await this.profileDAO.getById(userId);
    if (!profileData) {
      throw new NotFoundError('Profile not found');
    }

    // Calculate age from birthday if available
    let age = '';
    if (profileData.birthday) {
      const birthDate = new Date(profileData.birthday);
      const today = new Date();
      const ageNum = today.getFullYear() - birthDate.getFullYear();
      age = ageNum.toString();
    }

    try {
      const questionData = await generateQuestionFlow({
        existingSummary: profileData.summary,
        existingSuggestions: profileData.suggestions,
        existingEmotionalOverview: profileData.insights?.emotional_overview || '',
        existingKeyMoments: profileData.insights?.key_moments || '',
        existingRecurringThemes: profileData.insights?.recurring_themes || '',
        existingProgressAndGrowth: profileData.insights?.progress_and_growth || '',
        gender: profileData.gender,
        location: profileData.location,
        age,
      });

      trackApiEvent(EventName.QUESTION_GENERATED, userId);

      logger.info(`Successfully generated question for user ${userId}`);
      return { question: questionData.question };
    } catch (error) {
      logger.error('Failed to generate question', { error });
      throw new BadRequestError('Failed to generate question. Please try again.');
    }
  }

  /**
   * Nudges a user with rate limiting and friendship validation
   */
  async nudgeUser(currentUserId: string, targetUserId: string): Promise<{ message: string }> {
    logger.info(`User ${currentUserId} nudging user ${targetUserId}`);

    if (currentUserId === targetUserId) {
      throw new BadRequestError('You cannot nudge yourself');
    }

    // Check friendship
    const areFriends = await this.friendshipDAO.areFriends(currentUserId, targetUserId);
    if (!areFriends) {
      throw new ForbiddenError('You must be friends with this user to nudge them');
    }

    // Check rate limiting
    const nudgeQuery = this.db
      .collection(Collections.PROFILES)
      .doc(targetUserId)
      .collection(Collections.NUDGES)
      .withConverter(nudgeConverter)
      .where('sender_id', '==', currentUserId)
      .orderBy('timestamp', 'desc')
      .limit(1);

    const nudgeSnapshot = await nudgeQuery.get();
    if (!nudgeSnapshot.empty) {
      const lastNudge = nudgeSnapshot.docs[0]?.data();
      if (lastNudge) {
        const lastNudgeTime = lastNudge.timestamp.toMillis();
        const now = Date.now();
        if (now - lastNudgeTime < NUDGE_COOLDOWN_MS) {
          throw new ConflictError('You can only nudge this user once per hour');
        }
      }
    }

    // Get profiles for notification
    const [currentProfile, targetProfile] = await Promise.all([
      this.profileDAO.getById(currentUserId),
      this.profileDAO.getById(targetUserId),
    ]);

    if (!currentProfile || !targetProfile) {
      throw new NotFoundError('Profile not found');
    }

    // Check if target user has a device for notifications
    const deviceQuery = this.db
      .collection(Collections.DEVICES)
      .withConverter(deviceConverter)
      .where('user_id', '==', targetUserId)
      .limit(1);

    const deviceSnapshot = await deviceQuery.get();
    if (deviceSnapshot.empty) {
      throw new BadRequestError('User does not have push notifications enabled');
    }

    // Create nudge record
    const nudgeRef = this.db.collection(Collections.PROFILES).doc(targetUserId).collection(Collections.NUDGES).doc();

    await nudgeRef.set({
      sender_id: currentUserId,
      receiver_id: targetUserId,
      timestamp: Timestamp.now(),
    });

    // Send notification
    await sendNotification(
      targetUserId,
      `${currentProfile.name || currentProfile.username} nudged you!`,
      'Tap to share an update with your Village',
      {
        type: NotificationTypes.NUDGE,
        nudger_id: currentUserId,
      },
    );

    trackApiEvent(EventName.USER_NUDGED, currentUserId, {
      target_user_id: targetUserId,
    });

    logger.info(`Successfully nudged user ${targetUserId}`);
    return { message: 'Nudge sent successfully' };
  }

  /**
   * Looks up users by phone numbers
   */
  async lookupByPhones(phones: string[]): Promise<PhoneLookupResponse> {
    logger.info(`Looking up phones`, { count: phones.length });

    const matches = await this.phoneDAO.lookupMultiple(phones);

    const baseUsers: BaseUser[] = matches.map((match) => ({
      user_id: match.user_id,
      username: match.username,
      name: match.name,
      avatar: match.avatar,
    }));

    trackApiEvent(EventName.PHONES_LOOKED_UP, 'system', {
      requested_count: phones.length,
      match_count: baseUsers.length,
    });

    logger.info(`Phone lookup completed`, { requested: phones.length, found: baseUsers.length });
    return { matches: baseUsers };
  }

  /**
   * Gets user's friends with pagination
   */
  async getFriends(
    userId: string,
    pagination?: { limit?: number; after_cursor?: string },
  ): Promise<{ friends: FriendDoc[]; next_cursor: string | null }> {
    logger.info(`Getting friends for user ${userId}`, { pagination });

    const limit = pagination?.limit || 25;
    const afterCursor = pagination?.after_cursor;

    const result = await this.friendshipDAO.getFriends(userId, limit, afterCursor, true);

    logger.info(`Retrieved ${result.friends.length} friends for user ${userId}`);
    return {
      friends: result.friends,
      next_cursor: result.nextCursor,
    };
  }

  /**
   * Removes a friend (bidirectional)
   */
  async removeFriend(userId: string, friendId: string): Promise<void> {
    logger.info(`Removing friendship: ${userId} <-> ${friendId}`);

    // Check if friendship exists
    const areFriends = await this.friendshipDAO.areFriends(userId, friendId);
    if (!areFriends) {
      throw new NotFoundError('Friendship not found');
    }

    // Remove friendship bidirectionally
    const batch = this.db.batch();

    const userFriendRef = this.db
      .collection(Collections.PROFILES)
      .doc(userId)
      .collection(Collections.FRIENDS)
      .doc(friendId);

    const friendUserRef = this.db
      .collection(Collections.PROFILES)
      .doc(friendId)
      .collection(Collections.FRIENDS)
      .doc(userId);

    batch.delete(userFriendRef);
    batch.delete(friendUserRef);

    await batch.commit();

    // Update friend counts
    await Promise.all([
      this.profileDAO.update(userId, { friend_count: FieldValue.increment(-1) as unknown as number }),
      this.profileDAO.update(friendId, { friend_count: FieldValue.increment(-1) as unknown as number }),
    ]);

    trackApiEvent(EventName.FRIENDSHIP_REMOVED, userId, {
      friend_id: friendId,
    });

    logger.info(`Successfully removed friendship: ${userId} <-> ${friendId}`);
  }
}
