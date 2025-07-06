/**
 * Type definitions for analytics events
 */

// Event name enum
export enum EventName {
  API_ERROR = 'api_error',
  PROFILE_CREATED = 'profile_created',
  PROFILE_UPDATED = 'profile_updated',
  PROFILE_DELETED = 'profile_deleted',
  PROFILE_VIEWED = 'profile_viewed',
  FRIEND_PROFILE_VIEWED = 'friend_profile_viewed',
  UPDATE_CREATED = 'update_created',
  UPDATE_SHARED = 'update_shared',
  UPDATES_VIEWED = 'updates_viewed',
  FRIEND_UPDATES_VIEWED = 'friend_updates_viewed',
  FEED_VIEWED = 'feed_viewed',
  INVITE_VIEWED = 'invite_viewed',
  INVITE_RESET = 'invite_reset',
  JOIN_REQUESTED = 'join_requested',
  JOIN_ACCEPTED = 'join_accepted',
  JOIN_REJECTED = 'join_rejected',
  JOIN_REQUESTS_VIEWED = 'join_requests_viewed',
  JOIN_REQUEST_VIEWED = 'join_request_viewed',
  MY_JOIN_REQUESTS_VIEWED = 'my_join_requests_viewed',
  QUESTION_GENERATED = 'question_generated',
  FRIENDS_VIEWED = 'friends_viewed',
  COMMENT_CREATED = 'comment_created',
  COMMENT_UPDATED = 'comment_updated',
  COMMENT_DELETED = 'comment_deleted',
  COMMENTS_VIEWED = 'comments_viewed',
  REACTION_CREATED = 'reaction_created',
  REACTION_DELETED = 'reaction_deleted',
  SENTIMENT_ANALYZED = 'sentiment_analyzed',
  FEEDBACK_CREATED = 'feedback_created',
  NOTIFICATION_SENT = 'notification_sent',
  FRIENDSHIP_ACCEPTED = 'friendship_accepted',
  FRIENDSHIP_REMOVED = 'friendship_removed',
  DAILY_NOTIFICATIONS_SENT = 'daily_notifications_sent',
  DAILY_NOTIFICATION_SENT = 'daily_notification_sent',
  SUMMARY_CREATED = 'summary_created',
  FRIEND_SUMMARY_CREATED = 'friend_summary_created',
  USER_NUDGED = 'user_nudged',
  AUDIO_TRANSCRIBED = 'audio_transcribed',
  PHONES_LOOKED_UP = 'phones_looked_up',
  PHONE_MAPPING_CREATED = 'phone_mapping_created',
  PHONE_MAPPING_UPDATED = 'phone_mapping_updated',
  PHONE_MAPPING_DELETED = 'phone_mapping_deleted',
  INVITATION_NOTIFICATION_SENT = 'invitation_notification_sent',
  INVITATION_NOTIFICATIONS_SENT = 'invitation_notifications_sent',
  COMMENT_NOTIFICATION_SENT = 'comment_notification_sent',
  REACTION_NOTIFICATION_SENT = 'reaction_notification_sent',
  JOIN_REQUEST_NOTIFICATION_SENT = 'join_request_notification_sent',
  JOIN_REQUEST_UPDATE_NOTIFICATION_SENT = 'join_request_update_notifications_sent',
  LOCATION_UPDATED = 'location_updated',
  TIMEZONE_UPDATED = 'timezone_updated',
  DEVICE_RETRIEVED = 'device_retrieved',
  DEVICE_UPDATED = 'device_updated',
  DEVICE_REMOVED = 'device_removed',
  FRIENDSHIP_UPDATED = 'friendship_updated',
  FRIENDSHIP_DELETED = 'friendship_deleted',
  FRIENDSHIP_SYNCED = 'friendship_synced',
  FRIENDSHIP_SYNC_FAILED = 'friendship_sync_failed',
  FRIENDS_BATCH_DELETED = 'friends_batch_deleted',
  GROUP_CREATED = 'group_created',
  GROUP_MEMBERS_ADDED = 'group_members_added',
  GROUP_MESSAGE_SENT = 'group_message_sent',
  GROUP_MEMBERS_VIEWED = 'group_members_viewed',
  GROUP_FEED_VIEWED = 'group_feed_viewed',
  GROUP_CHATS_VIEWED = 'group_chats_viewed',
  USER_GROUPS_VIEWED = 'user_groups_viewed',
  UPDATE_VIEWED = 'update_viewed',
  JOIN_REQUEST_SENT = 'join_request_sent',
  JOIN_REQUEST_ACCEPTED = 'join_request_accepted',
  JOIN_REQUEST_REJECTED = 'join_request_rejected',
  INVITATION_RESET = 'invitation_reset',
  PROFILE_DENORMALIZATION_COMPLETED = 'profile_denormalization_completed',
  PROFILE_DENORMALIZATION_SKIPPED = 'profile_denormalization_skipped',
  USER_CLEANUP_COMPLETED = 'user_cleanup_completed',
}

// Base interface for all event parameters
export interface BaseEventParams {
  [key: string]: string | number | boolean;
}

// Profile Created event parameters
export interface ProfileEventParams extends BaseEventParams {
  has_name: boolean;
  has_avatar: boolean;
  has_location: boolean;
  has_birthday: boolean;
  has_notification_settings: boolean;
  nudging_occurrence: string;
  has_gender: boolean;
  goal: string;
  connect_to: string;
  personality: string;
  tone: string;
}

// Update event parameters
export interface UpdateEventParams extends BaseEventParams {
  content_length: number;
  sentiment: string;
  score: number;
  friend_count: number;
  group_count: number;
  all_village: boolean;
  image_count: number;
}

// Update event parameters
export interface UpdateViewEventParams extends BaseEventParams {
  update_count: number;
  user: string;
}

export interface UpdateViewEventWithCommentsParams extends BaseEventParams {
  comment_count: number;
  reaction_count: number;
  unique_creators: number;
  user: string;
}

// Feed event parameters
export interface FeedViewEventParams extends BaseEventParams {
  update_count: number;
  unique_creators: number;
}

// Invite event parameters
export interface InviteEventParams extends BaseEventParams {
  friend_count: number;
}

// Invite event parameters
export interface InviteResetEventParams extends BaseEventParams {
  friend_count: number;
  join_requests_deleted: number;
}

// Invite event parameters
export interface InviteJoinEventParams extends BaseEventParams {
  join_request_count: number;
}

// Question event parameters
export interface QuestionEventParams extends BaseEventParams {
  question_length: number;
}

// Friend event parameters
export interface FriendEventParams extends BaseEventParams {
  friend_count: number;
}

// Comment event parameters
export interface CommentEventParams extends BaseEventParams {
  comment_length: number;
  comment_count: number;
  reaction_count: number;
}

// Comment view event parameters
export interface CommentViewEventParams extends BaseEventParams {
  comment_count: number;
  reaction_count: number;
  unique_creators: number;
}

// Reaction event parameters
export interface ReactionEventParams extends BaseEventParams {
  reaction_count: number;
  comment_count: number;
}

// Analyze sentiment event parameters
export interface AnalyzeSentimentEventParams extends BaseEventParams {
  sentiment: string;
  score: number;
  emoji: string;
}

// Feedback event parameters
export interface FeedbackEventParams extends BaseEventParams {
  feedback_length: number;
}

// Notifications event parameters
export interface NotificationsEventParams extends BaseEventParams {
  total_users_count: number;
  notification_all_account: number;
  notification_urgent_count: number;
  no_notification_count: number;
  friend_count: number;
  group_count: number;
  no_device_count: number;
  is_urgent: boolean;
}

// Notification event parameters
export interface NotificationEventParams extends BaseEventParams {
  notification_all: boolean;
  notification_urgent: boolean;
  no_notification: boolean;
  no_device: boolean;
  notification_length: number;
  is_urgent: boolean;
}

// Daily notifications event parameters
export interface DailyNotificationsEventParams extends BaseEventParams {
  total_users_count: number;
  notification_all_count: number;
  notification_urgent_count: number;
  no_notification_count: number;
  no_device_count: number;
}

// Invitation notifications event parameters
export interface InvitationNotificationsEventParams extends BaseEventParams {
  total_users_count: number;
  notified_count: number;
  has_friends_count: number;
  no_timestamp_count: number;
  profile_too_new_count: number;
  no_device_count: number;
}

// Invitation notification event parameters for a single user
export interface InvitationNotificationEventParams extends BaseEventParams {
  has_friends: boolean;
  has_timestamp: boolean;
  profile_too_new: boolean;
  has_device: boolean;
}

// Friendship acceptance event parameters
export interface FriendshipAcceptanceEventParams extends BaseEventParams {
  sender_has_name: boolean;
  sender_has_avatar: boolean;
  receiver_has_name: boolean;
  receiver_has_avatar: boolean;
  has_device: boolean;
}

// Summary event parameters
export interface SummaryEventParams extends BaseEventParams {
  update_length: number;
  update_sentiment: string;
  summary_length: number;
  suggestions_length: number;
  emotional_overview_length: number;
  key_moments_length: number;
  recurring_themes_length: number;
  progress_and_growth_length: number;
  has_name: boolean;
  has_avatar: boolean;
  has_location: boolean;
  has_birthday: boolean;
  has_gender: boolean;
  nudging_occurrence: string;
  goal: string;
  connect_to: string;
  personality: string;
  tone: string;
  friend_summary_count: number;
}

// Friend summary event parameters
export interface FriendSummaryEventParams extends BaseEventParams {
  summary_length: number;
  suggestions_length: number;
}

// User nudge event parameters
export interface UserNudgeEventParams extends BaseEventParams {
  target_user_id: string;
}

// Audio Transcribed event parameters
export interface AudioTranscribedEventParams extends BaseEventParams {
  mime_type: string;
  transcription_length_characters: number;
  sentiment: string;
  score: number;
  emoji: string;
}

// Phone lookup event parameters
export interface PhoneLookupEventParams extends BaseEventParams {
  requested_count: number;
  match_count: number;
}

// Delete profile event parameters
export interface DeleteProfileEventParams extends BaseEventParams {
  update_count: number;
  feed_count: number;
  friend_count: number;
  summary_count: number;
  group_count: number;
  device_count: number;
  invitation_count: number;
}

// Share update event parameters
export interface ShareUpdateEventParams extends BaseEventParams {
  new_friends_count: number;
  total_friends_count: number;
  new_groups_count: number;
  total_groups_count: number;
}

// Friendship removal event parameters
export interface FriendshipRemovalEventParams extends BaseEventParams {
  friend_count_before: number;
  friend_count_after: number;
}

// User cleanup event parameters
export interface UserCleanupEventParams extends BaseEventParams {
  total_operations: number;
  failure_count: number;
  phone_cleanup_count: number;
  device_cleanup_count: number;
  friendship_cleanup_count: number;
  invitation_cleanup_count: number;
  nudge_cleanup_count: number;
  summary_cleanup_count: number;
  update_cleanup_count: number;
  feed_cleanup_count: number;
  group_cleanup_count: number;
  time_bucket_cleanup_success: boolean;
  feedback_cleanup_count: number;
  storage_cleanup_success: boolean;
}

// Response Types
export interface ErrorResponse {
  code: number;
  name: string;
  description: string;
}

export interface AnalyticsEvent {
  event: EventName;
  userId: string;
  params: BaseEventParams;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  analytics?: AnalyticsEvent;
}
