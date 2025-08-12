// Constants for query operations
export const MAX_BATCH_SIZE = 10;
export const MAX_BATCH_OPERATIONS = 400;
export const SYSTEM_USER = 'system';

// Collection names
export const Collections = {
  PROFILES: 'profiles',
  UPDATES: 'updates',
  GROUPS: 'groups',
  USER_SUMMARIES: 'user_summaries',
  CHATS: 'chats',
  INSIGHTS: 'insights',
  INVITATIONS: 'invitations',
  JOIN_REQUESTS: 'join_requests',
  DEVICES: 'devices',
  COMMENTS: 'comments',
  REACTIONS: 'reactions',
  FEEDBACK: 'feedback',
  USER_FEEDS: 'user_feeds',
  FEED: 'feed',
  NUDGES: 'nudges',
  TIME_BUCKETS: 'time_buckets',
  TIME_BUCKET_USERS: 'users',
  PHONES: 'phones',
  FRIENDS: 'friends',
} as const;

// Document names
export const Documents = {
  DEFAULT_INSIGHTS: 'default',
} as const;

// Status values
export const Status = {
  ACCEPTED: 'accepted',
  PENDING: 'pending',
  REJECTED: 'rejected',
} as const;

// Query operators
export const QueryOperators = {
  ARRAY_CONTAINS: 'array-contains',
  ARRAY_CONTAINS_ANY: 'array-contains-any',
  IN: 'in',
  EQUALS: '==',
  GREATER_THAN: '>',
  DESC: 'desc',
  ASC: 'asc',
} as const;

// Options for notification settings
export const NotificationFields = {
  ALL: 'all',
  URGENT: 'urgent',
} as const;

// Notification types for sendNotification
export const NotificationTypes = {
  NUDGE: 'nudge',
  JOIN_REQUEST: 'join_request',
  JOIN_REQUEST_BACKGROUND: 'join_request_background',
  REACTION: 'reaction',
  REACTION_BACKGROUND: 'reaction_background',
  DAILY: 'daily',
  NO_FRIENDS_REMINDER: 'no_friends_reminder',
  UPDATE: 'update',
  UPDATE_BACKGROUND: 'update_background',
  JOIN_REQUEST_REJECTED: 'join_request_rejected',
  JOIN_REQUEST_REJECTED_BACKGROUND: 'join_request_rejected_background',
  FRIENDSHIP: 'friendship',
  COMMENT: 'comment',
  COMMENT_BACKGROUND: 'comment_background',
  DEFAULT: 'default',
  BACKGROUND: 'background',
} as const;

// Options for nudging settings
export const NudgingFields = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  NEVER: 'never',
  FEW_DAYS: 'few_days',
} as const;

// Options for days of the week
export const DaysOfWeek = {
  MONDAY: 'monday',
  TUESDAY: 'tuesday',
  WEDNESDAY: 'wednesday',
  THURSDAY: 'thursday',
  FRIDAY: 'friday',
  SATURDAY: 'saturday',
  SUNDAY: 'sunday',
} as const;

// Options for goal settings
export const GoalFields = {
  STAY_CONNECTED: 'stay_connected',
  CHECK_IN: 'check_in',
  IMPROVE_RELATIONSHIPS: 'improve_relationships',
  MEET_NEW_PEOPLE: 'meet_new_people',
  NOT_SURE: 'not_sure',
} as const;

// Options for connect_to settings
export const ConnectToFields = {
  FRIENDS: 'friends',
  FAMILY: 'family',
  PARTNER: 'partner',
  NEW_PEOPLE: 'new_people',
} as const;

// Options for personality settings
export const PersonalityFields = {
  SHARE_LITTLE: 'share_little',
  SHARE_BIG: 'share_big',
  KEEP_TO_SELF: 'keep_to_self',
  SHARE_MORE: 'share_more',
} as const;

// Options for tone settings
export const ToneFields = {
  LIGHT_AND_CASUAL: 'light_and_casual',
  DEEP_AND_REFLECTIVE: 'deep_and_reflective',
  SURPRISE_ME: 'surprise_me',
} as const;

// Placeholders for empty profile fields
export const Placeholders = {
  SUMMARY:
    "See your recent updates' summary here! Spill more to get your insights and to share with your Town privately",
  SUGGESTIONS: 'Share more to get personalised suggestions',
  EMOTIONAL_OVERVIEW: 'Give us a bit more to understand your emotional state',
  RECURRING_THEMES: "Too early to identify patterns, let's see what emerges here",
  KEY_MOMENTS: 'Highs & lows? Spill the tea on the epic wins and the "oof" moments!',
  PROGRESS_AND_GROWTH: "Tell us more to see how you're leveling up and growing",
} as const;

// Unique parts for checking friend summary placeholders (robust against name changes)
export const FriendPlaceholderChecks = {
  SUMMARY_END: 'to spill more so that you can get the inside scoop into their life',
  SUGGESTIONS_END: 'to share more updates. More updates = better hangout suggestions online & offline!',
} as const;

// Templates for friend summary placeholders (requires name substitution)
export const FriendPlaceholderTemplates = {
  SUMMARY: 'Ask <FRIEND_NAME> ' + FriendPlaceholderChecks.SUMMARY_END,
  SUGGESTIONS: 'Nudge <FRIEND_NAME> ' + FriendPlaceholderChecks.SUGGESTIONS_END,
} as const;
