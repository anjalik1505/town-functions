import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateCreatorProfileFlow, generateQuestionFlow } from '../ai/flows.js';
import { DeviceDAO } from '../dao/device-dao.js';
import { FriendshipDAO } from '../dao/friendship-dao.js';
import { NudgeDAO } from '../dao/nudge-dao.js';
import { PhoneDAO } from '../dao/phone-dao.js';
import { ProfileDAO } from '../dao/profile-dao.js';
import { TimeBucketDAO } from '../dao/time-bucket-dao.js';
import { UserSummaryDAO } from '../dao/user-summary-dao.js';
import { ApiResponse, EventName, SummaryEventParams } from '../models/analytics-events.js';
import { NotificationTypes } from '../models/constants.js';
import {
  BaseUser,
  CreateProfilePayload,
  Friend,
  FriendProfileResponse,
  FriendsResponse,
  Location,
  NudgeResponse,
  PhoneLookupResponse,
  ProfileResponse,
  QuestionResponse,
  Timezone,
  UpdateProfilePayload,
} from '../models/data-models.js';
import { InsightsDoc } from '../models/firestore/insights-doc.js';
import { PhoneDoc } from '../models/firestore/phone-doc.js';
import {
  DayOfWeek,
  DaysOfWeek,
  NotificationSetting,
  NudgingOccurrence,
  NudgingOccurrenceType,
  NudgingSettings,
  Personality,
  ProfileDoc,
  Tone,
} from '../models/firestore/profile-doc.js';
import { UpdateDoc } from '../models/firestore/update-doc.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { sendNotification } from '../utils/notification-utils.js';
import {
  calculateAge,
  extractConnectToForAnalytics,
  extractGoalForAnalytics,
  extractNudgingOccurrence,
  formatProfileResponse,
} from '../utils/profile-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';

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
  private timeBucketDAO: TimeBucketDAO;
  private nudgeDAO: NudgeDAO;
  private userSummaryDAO: UserSummaryDAO;
  private deviceDAO: DeviceDAO;
  private db: FirebaseFirestore.Firestore;

  constructor() {
    this.profileDAO = new ProfileDAO();
    this.friendshipDAO = new FriendshipDAO();
    this.phoneDAO = new PhoneDAO();
    this.timeBucketDAO = new TimeBucketDAO();
    this.nudgeDAO = new NudgeDAO();
    this.userSummaryDAO = new UserSummaryDAO();
    this.deviceDAO = new DeviceDAO();
    this.db = getFirestore();
  }

  /**
   * Creates a new user profile with phone validation and analytics tracking
   */
  async createProfile(userId: string, data: CreateProfilePayload): Promise<ApiResponse<ProfileResponse>> {
    logger.info(`Creating profile for user ${userId}`, { data });

    // Check if profile already exists
    const existingProfile = await this.profileDAO.get(userId);
    if (existingProfile) {
      throw new BadRequestError(`Profile already exists for user ${userId}`);
    }

    // Validate phone uniqueness if provided
    if (data.phone_number) {
      const phoneExists = await this.phoneDAO.exists(data.phone_number);
      if (phoneExists) {
        throw new ConflictError('Phone number is already associated with another account');
      }
    }

    let nudgingSettings: NudgingSettings;
    if (data.nudging_settings) {
      nudgingSettings = {
        occurrence: data.nudging_settings.occurrence as NudgingOccurrenceType,
        times_of_day: (data.nudging_settings.times_of_day || []) as string[],
        days_of_week: (data.nudging_settings.days_of_week || []) as DayOfWeek[],
      };
    } else {
      nudgingSettings = {
        occurrence: NudgingOccurrence.NEVER,
        times_of_day: [],
        days_of_week: [],
      };
    }

    // Create profile with default values
    const profileData: Partial<ProfileDoc> = {
      user_id: userId,
      username: data.username,
      name: data.name || '',
      avatar: data.avatar || '',
      location: '',
      birthday: data.birthday || '',
      notification_settings: (data.notification_settings || []) as NotificationSetting[],
      nudging_settings: nudgingSettings,
      gender: data.gender || '',
      goal: data.goal || '',
      connect_to: data.connect_to || '',
      personality: (data.personality || '') as Personality,
      tone: (data.tone || 'light_and_casual') as Tone,
      phone_number: data.phone_number || '',
      group_ids: [],
      summary: '',
      suggestions: '',
      last_update_id: '',
      timezone: '',
      friends_to_cleanup: [],
      friend_count: 0,
    };

    // Create profile with insights in transaction and get the created profile
    const createdProfile = await this.profileDAO.create(userId, profileData);

    // Create phone mapping if phone number provided
    if (data.phone_number) {
      await this.phoneDAO.create(data.phone_number, {
        user_id: userId,
        username: data.username,
        name: data.name || '',
        avatar: data.avatar || '',
      });
    }

    // Extract analytics data from the created profile
    const analyticsData = this.profileDAO.extractAnalyticsData(createdProfile);

    // Format the response using the created profile
    const response = formatProfileResponse(userId, createdProfile, {
      emotional_overview: '',
      key_moments: '',
      recurring_themes: '',
      progress_and_growth: '',
    });

    logger.info(`Successfully created profile for user ${userId}`);

    return {
      data: response,
      status: 201,
      analytics: {
        event: EventName.PROFILE_CREATED,
        userId: userId,
        params: analyticsData,
      },
    };
  }

  /**
   * Gets a user's profile with formatted timestamps
   */
  async getProfile(userId: string): Promise<ApiResponse<ProfileResponse>> {
    logger.info(`Getting profile for user ${userId}`);

    const profileData = await this.profileDAO.get(userId);
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

    return {
      data: response,
      status: 200,
      analytics: {
        event: EventName.PROFILE_VIEWED,
        userId: userId,
        params: {},
      },
    };
  }

  /**
   * Updates a user's profile with phone conflict checking
   */
  async updateProfile(userId: string, data: UpdateProfilePayload): Promise<ApiResponse<ProfileResponse>> {
    logger.info(`Updating profile for user ${userId}`, { data });

    const existingProfile = await this.profileDAO.get(userId);
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

    let nudgingSettings: NudgingSettings;
    if (data.nudging_settings) {
      nudgingSettings = {
        occurrence: data.nudging_settings.occurrence as NudgingOccurrenceType,
        times_of_day: (data.nudging_settings.times_of_day || []) as string[],
        days_of_week: (data.nudging_settings.days_of_week || []) as DayOfWeek[],
      };
    } else {
      nudgingSettings = {
        occurrence: NudgingOccurrence.NEVER,
        times_of_day: [],
        days_of_week: [],
      };
    }

    // Check if nudging settings changed
    const nudgingSettingsChanged =
      data.nudging_settings && JSON.stringify(nudgingSettings) !== JSON.stringify(existingProfile.nudging_settings);

    // Prepare update data
    const updateData: Partial<ProfileDoc> = {
      ...data,
      updated_at: Timestamp.now(),
    } as Partial<ProfileDoc>;

    let updatedProfile: ProfileDoc;

    // If nudging settings changed, update profile and time buckets in a batch
    if (nudgingSettingsChanged) {
      const batch = this.db.batch();

      // Update profile in batch
      updatedProfile = await this.profileDAO.updateProfile(userId, updateData, batch);

      // Update time buckets in same batch
      const timezone = updatedProfile.timezone || existingProfile.timezone;
      await this.timeBucketDAO.update(userId, nudgingSettings, timezone, batch);

      // Commit the batch
      await batch.commit();
    } else {
      // Regular update without batch
      updatedProfile = await this.profileDAO.updateProfile(userId, updateData);
    }

    // Extract analytics data from the updated profile
    const analyticsData = this.profileDAO.extractAnalyticsData(updatedProfile);

    // Format the response using the updated profile
    const response = formatProfileResponse(
      userId,
      updatedProfile,
      existingProfile.insights || {
        emotional_overview: '',
        key_moments: '',
        recurring_themes: '',
        progress_and_growth: '',
      },
    );

    logger.info(`Successfully updated profile for user ${userId}`);

    return {
      data: response,
      status: 200,
      analytics: {
        event: EventName.PROFILE_UPDATED,
        userId: userId,
        params: analyticsData,
      },
    };
  }

  /**
   * Deletes a user's profile with cascade deletion
   */
  async deleteProfile(userId: string): Promise<ApiResponse<null>> {
    logger.info(`Deleting profile for user ${userId}`);

    const profile = await this.profileDAO.get(userId);
    if (!profile) {
      throw new NotFoundError('Profile not found');
    }

    // Delete phone mapping if exists
    if (profile.phone_number) {
      await this.phoneDAO.delete(profile.phone_number);
    }

    // Extract friends list before deletion
    const friendIds = await this.friendshipDAO.getFriendIds(userId);
    logger.info(`Found ${friendIds.length} friends for user ${userId}`);

    // Store friends list in profile document for trigger to use
    if (friendIds.length > 0) {
      await this.profileDAO.updateProfile(userId, {
        friends_to_cleanup: friendIds,
      });
      logger.info(`Stored ${friendIds.length} friend IDs in profile document for cleanup`);
    }

    // Use recursiveDelete to delete the profile document and all its subcollections
    await this.profileDAO.delete(userId);
    logger.info(`Profile document and all subcollections deleted for user ${userId}`);

    // Extract analytics data
    const analyticsData = this.profileDAO.extractAnalyticsData(profile);

    return {
      data: null,
      status: 204,
      analytics: {
        event: EventName.PROFILE_DELETED,
        userId: userId,
        params: analyticsData,
      },
    };
  }

  /**
   * Deletes user summaries where user is creator or target
   * @param userId The user ID whose summaries to delete
   * @returns Number of summaries deleted
   */
  async deleteUserSummaries(userId: string): Promise<number> {
    logger.info(`Deleting user summaries for user ${userId}`);

    let totalDeleted = 0;
    let currentBatch = this.db.batch();
    let batchOperations = 0;
    const MAX_BATCH_OPERATIONS = 500;

    try {
      // Delete summaries where user is creator
      for await (const { ref } of this.userSummaryDAO.streamSummariesByCreator(userId)) {
        currentBatch.delete(ref);
        batchOperations++;
        totalDeleted++;

        // Commit batch when reaching limit
        if (batchOperations >= MAX_BATCH_OPERATIONS) {
          await currentBatch.commit();
          logger.info(`Committed batch of ${batchOperations} user summary deletions (creator) for user ${userId}`);
          currentBatch = this.db.batch();
          batchOperations = 0;
        }
      }

      // Delete summaries where user is target
      for await (const { ref } of this.userSummaryDAO.streamSummariesByTarget(userId)) {
        currentBatch.delete(ref);
        batchOperations++;
        totalDeleted++;

        // Commit batch when reaching limit
        if (batchOperations >= MAX_BATCH_OPERATIONS) {
          await currentBatch.commit();
          logger.info(`Committed batch of ${batchOperations} user summary deletions (target) for user ${userId}`);
          currentBatch = this.db.batch();
          batchOperations = 0;
        }
      }

      // Commit remaining operations
      if (batchOperations > 0) {
        await currentBatch.commit();
        logger.info(`Committed final batch of ${batchOperations} user summary deletions for user ${userId}`);
      }

      logger.info(`Deleted ${totalDeleted} user summaries for user ${userId}`);
      return totalDeleted;
    } catch (error) {
      logger.error(`Failed to delete user summaries for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * Removes user from time buckets
   * @param userId The user ID to remove from time buckets
   * @returns Boolean indicating success/failure
   */
  async removeFromTimeBuckets(userId: string): Promise<boolean> {
    logger.info(`Removing user ${userId} from time buckets`);

    try {
      await this.timeBucketDAO.remove(userId);
      logger.info(`Removed user ${userId} from time buckets`);
      return true;
    } catch (error) {
      logger.error(`Error removing user ${userId} from time buckets: ${error}`);
      return false;
    }
  }

  /**
   * Deletes user's avatar from Firebase Storage if it exists
   * Handles Google avatars (skips deletion) and Firebase Storage URLs (gs:// and HTTPS)
   * @param userId The user ID whose avatar to delete
   * @param profileData The user's profile data containing avatar URL
   * @returns Boolean indicating success/failure
   */
  async deleteStorageAssets(userId: string, profileData: ProfileDoc): Promise<boolean> {
    logger.info(`Checking for avatar to delete for user ${userId}`);

    const avatarUrl = profileData.avatar;
    if (!avatarUrl) {
      logger.info(`User ${userId} has no avatar, skipping avatar deletion`);
      return true;
    }

    try {
      if (avatarUrl.includes('googleusercontent.com')) {
        logger.info(`Avatar for user ${userId} is from Google account, skipping deletion`);
        return true;
      }

      if (!avatarUrl.includes('firebasestorage.googleapis.com') && !avatarUrl.startsWith('gs://')) {
        logger.info(`Avatar URL for user ${userId} is not from Firebase Storage, skipping deletion`);
        return true;
      }

      const storage = getStorage();

      try {
        if (avatarUrl.startsWith('gs://')) {
          const gsPath = avatarUrl.substring(5);
          const slashIndex = gsPath.indexOf('/');
          if (slashIndex === -1) {
            throw new Error(`Invalid gs:// URL format: ${avatarUrl}`);
          }

          const bucketName = gsPath.substring(0, slashIndex);
          const filePath = gsPath.substring(slashIndex + 1);

          await storage.bucket(bucketName).file(filePath).delete();
        } else {
          const match = avatarUrl.match(/firebasestorage\.googleapis\.com\/v0\/b\/([^\/]+)\/o\/([^?]+)/);
          if (!match || match.length < 3) {
            throw new Error(`Could not parse Firebase Storage URL: ${avatarUrl}`);
          }

          const bucketName = match[1];
          const filePath = decodeURIComponent(match[2] || '');

          await storage.bucket(bucketName).file(filePath).delete();
        }

        logger.info(`Deleted avatar for user ${userId}`);
        return true;
      } catch (storageError) {
        logger.error(`Error deleting avatar file for user ${userId}: ${storageError}`);
        return false;
      }
    } catch (error) {
      logger.error(`Error deleting avatar for user ${userId}: ${error}`);
      return false;
    }
  }

  /**
   * Gets a friend's profile with access validation
   */
  async getFriendProfile(currentUserId: string, targetUserId: string): Promise<ApiResponse<FriendProfileResponse>> {
    logger.info(`Getting friend profile: ${currentUserId} -> ${targetUserId}`);

    // Check if users are friends
    const areFriends = await this.friendshipDAO.areFriends(currentUserId, targetUserId);
    if (!areFriends) {
      throw new ForbiddenError('You must be friends with this user to view their profile');
    }

    const profileData = await this.profileDAO.get(targetUserId);
    if (!profileData) {
      throw new NotFoundError('Profile not found');
    }

    // Get summary and suggestions from user summaries collection
    const summaryData = await this.userSummaryDAO.getSummary(currentUserId, targetUserId);
    const summary = summaryData?.summary || '';
    const suggestions = summaryData?.suggestions || '';

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

    return {
      data: response,
      status: 200,
      analytics: {
        event: EventName.FRIEND_PROFILE_VIEWED,
        userId: currentUserId,
        params: { target_user_id: targetUserId },
      },
    };
  }

  /**
   * Updates user location
   */
  async updateLocation(userId: string, data: { location: string }): Promise<ApiResponse<Location>> {
    logger.info(`Updating location for user ${userId}`, { data });
    const updatedProfile = await this.profileDAO.updateProfile(userId, { location: data.location });
    logger.info(`Successfully updated location for user ${userId}`);

    const location: Location = {
      location: updatedProfile.location,
      updated_at: formatTimestamp(updatedProfile.updated_at),
    };

    return {
      data: location,
      status: 200,
      analytics: {
        event: EventName.LOCATION_UPDATED,
        userId: userId,
        params: {},
      },
    };
  }

  /**
   * Updates user timezone
   */
  async updateTimezone(userId: string, data: { timezone: string }): Promise<ApiResponse<Timezone>> {
    logger.info(`Updating timezone for user ${userId}`, { data });

    // Get existing profile to check for nudging settings and timezone change
    const existingProfile = await this.profileDAO.get(userId);
    if (!existingProfile) {
      throw new NotFoundError('Profile not found');
    }

    const currentTimezone = existingProfile.timezone;
    const nudgingSettings = existingProfile.nudging_settings;

    // Create batch for atomic updates
    const batch = this.db.batch();

    // Update timezone in profile using batch
    const updatedProfile = await this.profileDAO.updateProfile(userId, { timezone: data.timezone }, batch);

    // Update time bucket membership if timezone changed and nudging is enabled
    if (currentTimezone !== data.timezone && nudgingSettings && nudgingSettings.occurrence !== 'never') {
      await this.timeBucketDAO.update(userId, nudgingSettings, data.timezone, batch);
    }

    // Commit the batch
    await batch.commit();

    logger.info(`Successfully updated timezone for user ${userId}`);

    const timezone: Timezone = {
      timezone: data.timezone,
      updated_at: formatTimestamp(updatedProfile.updated_at),
    };

    return {
      data: timezone,
      status: 200,
      analytics: {
        event: EventName.TIMEZONE_UPDATED,
        userId: userId,
        params: {},
      },
    };
  }

  /**
   * Generates a personalized question for the user using AI
   */
  async generateQuestion(userId: string): Promise<ApiResponse<QuestionResponse>> {
    logger.info(`Generating question for user ${userId}`);

    const profileData = await this.profileDAO.get(userId);
    if (!profileData) {
      throw new NotFoundError('Profile not found');
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
        age: calculateAge(profileData.birthday || ''),
      });

      logger.info(`Successfully generated question for user ${userId}`);

      return {
        data: { question: questionData.question },
        status: 200,
        analytics: {
          event: EventName.QUESTION_GENERATED,
          userId: userId,
          params: { question_length: questionData.question.length },
        },
      };
    } catch (error) {
      logger.error('Failed to generate question', { error });
      throw new BadRequestError('Failed to generate question. Please try again.');
    }
  }

  /**
   * Nudges a user with rate limiting and friendship validation
   */
  async nudgeUser(currentUserId: string, targetUserId: string): Promise<ApiResponse<NudgeResponse>> {
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
    const canNudge = await this.nudgeDAO.canSend(targetUserId, currentUserId, NUDGE_COOLDOWN_MS);
    if (!canNudge) {
      throw new ConflictError('You can only nudge this user once per hour');
    }

    // Get profiles for notification
    const [currentProfile, targetProfile] = await Promise.all([
      this.profileDAO.get(currentUserId),
      this.profileDAO.get(targetUserId),
    ]);

    if (!currentProfile || !targetProfile) {
      throw new NotFoundError('Profile not found');
    }

    // Check if target user has a device for notifications
    const hasDevice = await this.deviceDAO.exists(targetUserId);

    // Upsert nudge record
    await this.nudgeDAO.upsert(targetUserId, currentUserId);

    // Send notification only if device exists
    if (hasDevice) {
      const currentUserName = currentProfile.name || currentProfile.username || 'A friend';
      try {
        await sendNotification(
          targetUserId,
          'You’ve been on someone’s mind',
          `${currentUserName} is checking in and curious about how you're doing!`,
          {
            type: NotificationTypes.NUDGE,
            nudger_id: currentUserId,
          },
        );
        logger.info(`Successfully sent nudge notification to user ${targetUserId}`);
      } catch (error) {
        logger.error(`Error sending nudge notification to user ${targetUserId}: ${error}`);
        // Continue execution even if notification fails
      }
    }

    logger.info(`Successfully nudged user ${targetUserId}`);

    return {
      data: { message: 'Nudge sent successfully' },
      status: 200,
      analytics: {
        event: EventName.USER_NUDGED,
        userId: currentUserId,
        params: { target_user_id: targetUserId },
      },
    };
  }

  /**
   * Looks up users by phone numbers
   */
  async lookupByPhones(userId: string, phones: string[]): Promise<ApiResponse<PhoneLookupResponse>> {
    logger.info(`Looking up phones`, { count: phones.length });

    const matches = await this.phoneDAO.getAll(phones);

    const baseUsers: BaseUser[] = matches.map((match) => ({
      user_id: match.user_id,
      username: match.username,
      name: match.name,
      avatar: match.avatar,
    }));

    logger.info(`Phone lookup completed`, { requested: phones.length, found: baseUsers.length });

    return {
      data: { matches: baseUsers } as PhoneLookupResponse,
      status: 200,
      analytics: {
        event: EventName.PHONES_LOOKED_UP,
        userId: userId,
        params: {
          requested_count: phones.length,
          match_count: baseUsers.length,
        },
      },
    };
  }

  /**
   * Gets user's friends with pagination
   */
  async getFriends(
    userId: string,
    pagination?: { limit?: number; after_cursor?: string },
  ): Promise<ApiResponse<FriendsResponse>> {
    logger.info(`Getting friends for user ${userId}`, { pagination });

    const limit = pagination?.limit || 20;
    const afterCursor = pagination?.after_cursor;

    const result = await this.friendshipDAO.getFriends(userId, limit, afterCursor);

    logger.info(`Retrieved ${result.friends.length} friends for user ${userId}`);

    return {
      data: {
        friends: result.friends.map(
          (friend) =>
            ({
              user_id: friend.userId,
              username: friend.username,
              name: friend.name,
              avatar: friend.avatar,
              last_update_emoji: friend.last_update_emoji,
              last_update_time: formatTimestamp(friend.last_update_at),
            }) as Friend,
        ),
        next_cursor: result.nextCursor,
      } as FriendsResponse,
      status: 200,
      analytics: {
        event: EventName.FRIENDS_VIEWED,
        userId: userId,
        params: { friend_count: result.friends.length },
      },
    };
  }

  /**
   * Removes a friend (bidirectional)
   */
  async removeFriend(userId: string, friendId: string): Promise<ApiResponse<null>> {
    logger.info(`Removing friendship: ${userId} <-> ${friendId}`);

    const areFriends = await this.friendshipDAO.areFriends(userId, friendId);

    if (!areFriends) {
      throw new NotFoundError('Friendship not found');
    }

    // Create a batch for atomic operations
    const batch = this.db.batch();

    // Remove friendship documents in the batch
    await this.friendshipDAO.remove(userId, friendId, batch);

    // Decrement friend counts for both users in the same batch
    this.profileDAO.decrementFriendCount(userId, batch);
    this.profileDAO.decrementFriendCount(friendId, batch);

    // Commit all operations atomically
    await batch.commit();

    logger.info(`Successfully removed friendship and updated friend counts for ${userId} and ${friendId}`);

    return {
      data: null,
      status: 200,
      analytics: {
        event: EventName.FRIENDSHIP_REMOVED,
        userId: userId,
        params: { friend_id: friendId },
      },
    };
  }

  /**
   * Gets users eligible for daily notifications from current time bucket
   * Filters out users who have posted in the last 24 hours
   */
  async getUsersForDailyNotifications(): Promise<ProfileDoc[]> {
    logger.info('Getting users for daily notifications');

    // Calculate current time bucket using proper enums
    const now = Timestamp.now().toDate();
    const dayIndex = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
    const dayMapping = [
      DaysOfWeek.SUNDAY,
      DaysOfWeek.MONDAY,
      DaysOfWeek.TUESDAY,
      DaysOfWeek.WEDNESDAY,
      DaysOfWeek.THURSDAY,
      DaysOfWeek.FRIDAY,
      DaysOfWeek.SATURDAY,
    ];
    const dayName = dayMapping[dayIndex];
    const hour = now.getHours().toString().padStart(2, '0');
    const currentBucket = `${dayName}_${hour}:00`;

    logger.info(`Processing notifications for time bucket: ${currentBucket}`);

    try {
      // Get users in current time bucket using DAO
      const bucketUsers = await this.timeBucketDAO.getAll(currentBucket);

      if (bucketUsers.length === 0) {
        logger.info(`No users found in bucket ${currentBucket}`);
        return [];
      }

      logger.info(`Found ${bucketUsers.length} users in bucket ${currentBucket}`);

      const eligibleUsers: ProfileDoc[] = [];

      // Filter eligible user IDs using denormalized last_update_at field
      const cutoffTime = Timestamp.fromDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
      const eligibleUserIds: string[] = [];

      for (const bucketUser of bucketUsers) {
        try {
          // Check recent activity using denormalized last_update_at field
          if (bucketUser.last_update_at.seconds > cutoffTime.seconds) {
            logger.info(
              `Skipping user ${bucketUser.user_id} due to recent update (${bucketUser.last_update_at.toDate()})`,
            );
            continue;
          }

          eligibleUserIds.push(bucketUser.user_id);
        } catch (error) {
          logger.error(`Failed to process user ${bucketUser.user_id} in bucket ${currentBucket}`, error);
        }
      }

      if (eligibleUserIds.length === 0) {
        logger.info(`No eligible users found in bucket ${currentBucket} after activity filtering`);
        return [];
      }

      logger.info(`Found ${eligibleUserIds.length} eligible user IDs, fetching profiles in batch`);

      // Batch fetch all eligible profiles in a single query
      const profiles = await this.profileDAO.getAll(eligibleUserIds);

      // ProfileDAO.getAll() filters out non-existent profiles, so we can use them directly
      eligibleUsers.push(...profiles);

      // Log any missing profiles for debugging
      if (profiles.length < eligibleUserIds.length) {
        const foundUserIds = new Set(profiles.map((p) => p.user_id));
        const missingUserIds = eligibleUserIds.filter((id) => !foundUserIds.has(id));
        logger.warn(`Missing profiles for users: ${missingUserIds.join(', ')} in bucket ${currentBucket}`);
      }

      logger.info(`Found ${eligibleUsers.length} eligible users in bucket ${currentBucket}`);
      return eligibleUsers;
    } catch (error) {
      logger.error(`Failed to process time bucket ${currentBucket}`, error);
      return [];
    }
  }

  /**
   * Updates the last_update_at timestamp for a user across all their time buckets
   * Called when a user creates an update to track their posting activity
   * @param userId The user who created an update
   * @param updateTime The timestamp of the update creation
   */
  async updateUserLastUpdateTime(userId: string, updateTime: Timestamp): Promise<void> {
    logger.info(`Updating last update time for user ${userId}`);

    try {
      await this.timeBucketDAO.updateUserLastUpdateTime(userId, updateTime);
      logger.info(`Successfully updated last update time for user ${userId}`);
    } catch (error) {
      logger.error(`Failed to update last update time for user ${userId}`, error);
      throw error;
    }
  }

  /**
   * Processes creator profile updates with AI-generated insights after an update is created
   * @param updateData The update document data
   * @param imageAnalysis Already analyzed image description text
   * @returns Analytics data for the creator's profile update
   */
  async processUpdateCreatorProfile(updateData: UpdateDoc, imageAnalysis: string): Promise<SummaryEventParams> {
    const creatorId = updateData.created_by;

    if (!creatorId) {
      logger.error('Update has no creator ID');
      return {
        update_length: 0,
        update_sentiment: '',
        summary_length: 0,
        suggestions_length: 0,
        emotional_overview_length: 0,
        key_moments_length: 0,
        recurring_themes_length: 0,
        progress_and_growth_length: 0,
        has_name: false,
        has_avatar: false,
        has_location: false,
        has_birthday: false,
        has_gender: false,
        nudging_occurrence: '',
        goal: '',
        connect_to: '',
        personality: '',
        tone: '',
        friend_summary_count: 0,
      };
    }

    logger.info(`Processing creator profile update for user ${creatorId}`);

    // Get the profile document
    const profileData = await this.profileDAO.get(creatorId);

    if (!profileData) {
      logger.warn(`Profile not found for user ${creatorId}`);
      return {
        update_length: 0,
        update_sentiment: '',
        summary_length: 0,
        suggestions_length: 0,
        emotional_overview_length: 0,
        key_moments_length: 0,
        recurring_themes_length: 0,
        progress_and_growth_length: 0,
        has_name: false,
        has_avatar: false,
        has_location: false,
        has_birthday: false,
        has_gender: false,
        nudging_occurrence: '',
        goal: '',
        connect_to: '',
        personality: '',
        tone: '',
        friend_summary_count: 0,
      };
    }

    const existingSummary = profileData.summary;
    const existingSuggestions = profileData.suggestions;

    // Extract update content and sentiment
    const updateContent = updateData.content;
    const sentiment = updateData.sentiment;
    const updateId = updateData.id;

    // Calculate age from the birthday
    const age = calculateAge(profileData.birthday || '');

    // Use the creator profile flow to generate insights
    const result = await generateCreatorProfileFlow({
      existingSummary: existingSummary || '',
      existingSuggestions: existingSuggestions || '',
      existingEmotionalOverview: profileData.insights?.emotional_overview || '',
      existingKeyMoments: profileData.insights?.key_moments || '',
      existingRecurringThemes: profileData.insights?.recurring_themes || '',
      existingProgressAndGrowth: profileData.insights?.progress_and_growth || '',
      updateContent: updateContent || '',
      sentiment: sentiment || '',
      gender: profileData.gender || 'unknown',
      location: profileData.location || 'unknown',
      age: age,
      imageAnalysis: imageAnalysis,
    });

    // Prepare profile and insights updates
    const profileUpdate: Partial<ProfileDoc> = {
      summary: result.summary || '',
      suggestions: result.suggestions || '',
      last_update_id: updateId,
    };

    const insightsData: InsightsDoc = {
      emotional_overview: result.emotional_overview || '',
      key_moments: result.key_moments || '',
      recurring_themes: result.recurring_themes || '',
      progress_and_growth: result.progress_and_growth || '',
    };

    // Use ProfileDAO to update both profile and insights atomically
    await this.profileDAO.updateProfile(creatorId, profileUpdate, undefined, insightsData);
    logger.info(`Successfully updated creator profile and insights for user ${creatorId}`);

    // Return analytics data
    return {
      update_length: (updateData.content || '').length,
      update_sentiment: updateData.sentiment || '',
      summary_length: (result.summary || '').length,
      suggestions_length: (result.suggestions || '').length,
      emotional_overview_length: (result.emotional_overview || '').length,
      key_moments_length: (result.key_moments || '').length,
      recurring_themes_length: (result.recurring_themes || '').length,
      progress_and_growth_length: (result.progress_and_growth || '').length,
      has_name: !!profileData.name,
      has_avatar: !!profileData.avatar,
      has_location: !!profileData.location,
      has_birthday: !!profileData.birthday,
      has_gender: !!profileData.gender,
      nudging_occurrence: extractNudgingOccurrence(profileData),
      goal: extractGoalForAnalytics(profileData),
      connect_to: extractConnectToForAnalytics(profileData),
      personality: profileData.personality || '',
      tone: profileData.tone || '',
      friend_summary_count: (updateData.friend_ids || []).length,
    };
  }

  /**
   * Updates phone mapping denormalization when phone number or profile fields change
   */
  async updatePhoneMappingDenormalization(
    userId: string,
    beforeData: ProfileDoc,
    afterData: ProfileDoc,
  ): Promise<number> {
    logger.info(`Processing phone mapping denormalization for user ${userId}`);

    const oldPhone = beforeData.phone_number;
    const newPhone = afterData.phone_number;

    // If there's no new phone number, nothing to update
    if (!newPhone) {
      logger.info(`No phone number for user ${userId}, skipping phone mapping update`);
      return 0;
    }

    // Prepare the phone data with current profile information
    const phoneData: PhoneDoc = {
      user_id: userId,
      username: afterData.username || '',
      name: afterData.name || '',
      avatar: afterData.avatar || '',
    };

    // Use PhoneDAO's updateForUser method which handles all cases:
    // - If oldPhone !== newPhone: deletes old mapping and creates new
    // - If oldPhone === newPhone: just updates existing mapping
    await this.phoneDAO.update(oldPhone, newPhone, phoneData);

    logger.info(`Updated phone mapping for user ${userId}`);
    return 1;
  }
}
