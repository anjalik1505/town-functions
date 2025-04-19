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
  FRIENDS_VIEWED = 'friends_viewed'
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
}

// Update event parameters
export interface UpdateViewEventParams extends BaseEventParams {
  updates: number;
  user: string;
}

// Feed event parameters
export interface FeedViewEventParams extends BaseEventParams {
  updates: number;
  unique_creators: number;
}

// Invite event parameters
export interface InviteEventParams extends BaseEventParams {
  friends: number;
  invitations: number;
}

// Question event parameters
export interface QuestionEventParams extends BaseEventParams {
  question_length: number;
}

// Friend event parameters
export interface FriendEventParams extends BaseEventParams {
  friends: number;
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