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
  UPDATES_VIEWED = 'updates_viewed',
  FRIEND_UPDATES_VIEWED = 'friend_updates_viewed',
  FEED_VIEWED = 'feed_viewed',
  INVITE_CREATED = 'invite_created',
  INVITE_ACCEPTED = 'invite_accepted',
  INVITE_REJECTED = 'invite_rejected',
  INVITE_RESENT = 'invite_resent',
  INVITE_VIEWED = 'invite_viewed',
  INVITES_VIEWED = 'invites_viewed',
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
  DAILY_NOTIFICATIONS_SENT = 'daily_notifications_sent',
  DAILY_NOTIFICATION_SENT = 'daily_notification_sent',
  SUMMARY_CREATED = 'summary_created',
  FRIEND_SUMMARY_CREATED = 'friend_summary_created',
  USER_NUDGED = 'user_nudged',
}

// Base interface for all event parameters
export interface BaseEventParams {
  [key: string]: string | number | boolean;
}

// API Error event parameters
export interface ApiErrorEventParams extends BaseEventParams {
  error_type: string;
  error_message: string;
  error_code: number;
  path: string;
  method: string;
}

// Profile Created event parameters
export interface ProfileEventParams extends BaseEventParams {
  has_name: boolean;
  has_avatar: boolean;
  has_location: boolean;
  has_birthday: boolean;
  has_notification_settings: boolean;
  has_gender: boolean;
}

// Update event parameters
export interface UpdateEventParams extends BaseEventParams {
  content_length: number;
  sentiment: string;
  score: string;
  friend_count: number;
  group_count: number;
  all_village: boolean;
}

// Update event parameters
export interface UpdateViewEventParams extends BaseEventParams {
  update_count: number;
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
  invitation_count: number;
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

// Reactions event parameters
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
  notification_all_acount: number;
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
