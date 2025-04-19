/**
 * Type definitions for analytics events
 */

// Event name enum
export enum EventName {
  API_ERROR = 'api_error',
  PROFILE_CREATED = 'profile_created',
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
export interface ProfileCreatedEventParams extends BaseEventParams {
  has_avatar: boolean;
  has_location: boolean;
  has_birthday: boolean;
  has_notification_settings: boolean;
  has_gender: boolean;
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