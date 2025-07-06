import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import path from 'path';
import { fileURLToPath } from 'url';
import { FriendshipDAO } from '../dao/friendship-dao.js';
import { PhoneDAO } from '../dao/phone-dao.js';
import { ProfileDAO } from '../dao/profile-dao.js';
import { TimeBucketDAO } from '../dao/time-bucket-dao.js';
import { UserSummaryDAO } from '../dao/user-summary-dao.js';
import { ApiResponse, EventName } from '../models/analytics-events.js';
import {
  CreateProfilePayload,
  FriendProfileResponse,
  Insights,
  Location,
  ProfileResponse,
  Timezone,
  UpdateProfilePayload,
} from '../models/data-models.js';
import {
  DayOfWeek,
  NotificationSetting,
  NudgingOccurrence,
  NudgingOccurrenceType,
  NudgingSettings,
  Personality,
  PhoneDoc,
  ProfileDoc,
  Tone,
} from '../models/firestore/index.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../utils/errors.js';
import { getLogger } from '../utils/logging-utils.js';
import { formatTimestamp } from '../utils/timestamp-utils.js';

const __filename = fileURLToPath(import.meta.url);
const logger = getLogger(path.basename(__filename));

/**
 * Service layer for Profile-related operations
 * Coordinates between ProfileDAO, FriendshipDAO, and PhoneDAO
 */
export class ProfileService {
  private profileDAO: ProfileDAO;
  private friendshipDAO: FriendshipDAO;
  private phoneDAO: PhoneDAO;
  private timeBucketDAO: TimeBucketDAO;
  private userSummaryDAO: UserSummaryDAO;
  private db: FirebaseFirestore.Firestore;

  constructor() {
    this.profileDAO = new ProfileDAO();
    this.friendshipDAO = new FriendshipDAO();
    this.phoneDAO = new PhoneDAO();
    this.timeBucketDAO = new TimeBucketDAO();
    this.userSummaryDAO = new UserSummaryDAO();
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
    const response = this.formatProfileResponse(userId, createdProfile, {
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
    const response = this.formatProfileResponse(
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

  /**
   * Formats a profile document into a ProfileResponse object
   * @param userId The ID of the user
   * @param profileData The profile data
   * @param insightsData The insights data
   * @returns A formatted ProfileResponse object
   */
  private formatProfileResponse(userId: string, profileData: ProfileDoc, insightsData: Insights): ProfileResponse {
    const commonFields = this.formatCommonProfileFields(userId, profileData);

    // Handle nudging_settings as a nested object
    const nudgingSettings = profileData.nudging_settings;

    return {
      ...commonFields,
      notification_settings: profileData.notification_settings || [],
      nudging_settings: nudgingSettings,
      summary: profileData.summary || '',
      suggestions: profileData.suggestions || '',
      insights: insightsData,
      tone: profileData.tone || '',
      phone_number: profileData.phone_number || '',
    };
  }

  /**
   * Formats the common profile fields from profile data
   * @param userId The ID of the user
   * @param profileData The profile data
   * @returns Common profile fields
   */
  private formatCommonProfileFields(userId: string, profileData: ProfileDoc) {
    return {
      user_id: userId,
      username: profileData.username || '',
      name: profileData.name || '',
      avatar: profileData.avatar || '',
      location: profileData.location || '',
      birthday: profileData.birthday || '',
      gender: profileData.gender || '',
      timezone: profileData.timezone || '',
      updated_at: profileData.updated_at ? formatTimestamp(profileData.updated_at) : '',
    };
  }
}
