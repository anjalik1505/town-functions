// Constants for query operations
export const MAX_BATCH_SIZE = 10;
export const MAX_BATCH_OPERATIONS = 500;
export const SYSTEM_USER = 'system';

// Collection names
export const Collections = {
  PROFILES: 'profiles',
  UPDATES: 'updates',
  FRIENDSHIPS: 'friendships',
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

// Field names for Profile documents
export const ProfileFields = {
  USER_ID: 'user_id',
  NAME: 'name',
  USERNAME: 'username',
  AVATAR: 'avatar',
  LOCATION: 'location',
  BIRTHDAY: 'birthday',
  NOTIFICATION_SETTINGS: 'notification_settings',
  NUDGING_SETTINGS: 'nudging_settings',
  GENDER: 'gender',
  GROUP_IDS: 'group_ids',
  INSIGHTS: 'insights',
  SUMMARY: 'summary',
  SUGGESTIONS: 'suggestions',
  LAST_UPDATE_ID: 'last_update_id',
  UPDATED_AT: 'updated_at',
  CREATED_AT: 'created_at',
  LIMIT_OVERRIDE: 'limit_override',
  TIMEZONE: 'timezone',
  GOAL: 'goal',
  CONNECT_TO: 'connect_to',
  PERSONALITY: 'personality',
  TONE: 'tone',
} as const;

// Field names for Friendship documents
export const FriendshipFields = {
  SENDER_ID: 'sender_id',
  SENDER_USERNAME: 'sender_username',
  SENDER_NAME: 'sender_name',
  SENDER_AVATAR: 'sender_avatar',
  SENDER_LAST_UPDATE_EMOJI: 'sender_last_update_emoji',
  RECEIVER_ID: 'receiver_id',
  RECEIVER_USERNAME: 'receiver_username',
  RECEIVER_NAME: 'receiver_name',
  RECEIVER_AVATAR: 'receiver_avatar',
  RECEIVER_LAST_UPDATE_EMOJI: 'receiver_last_update_emoji',
  MEMBERS: 'members',
  CREATED_AT: 'created_at',
  UPDATED_AT: 'updated_at',
} as const;

// Field names for Invitation documents
export const InvitationFields = {
  CREATED_AT: 'created_at',
  SENDER_ID: 'sender_id',
  USERNAME: 'username',
  NAME: 'name',
  AVATAR: 'avatar',
} as const;

// Field names for JoinRequest documents
export const JoinRequestFields = {
  REQUEST_ID: 'request_id',
  INVITATION_ID: 'invitation_id',
  REQUESTER_ID: 'requester_id',
  RECEIVER_ID: 'receiver_id',
  STATUS: 'status',
  CREATED_AT: 'created_at',
  UPDATED_AT: 'updated_at',
  REQUESTER_NAME: 'requester_name',
  REQUESTER_USERNAME: 'requester_username',
  REQUESTER_AVATAR: 'requester_avatar',
  RECEIVER_NAME: 'receiver_name',
  RECEIVER_USERNAME: 'receiver_username',
  RECEIVER_AVATAR_OLD: 'v_avatar',
  RECEIVER_AVATAR: 'receiver_avatar',
} as const;

// Field names for Update documents
export const UpdateFields = {
  CREATED_BY: 'created_by',
  CONTENT: 'content',
  GROUP_IDS: 'group_ids',
  FRIEND_IDS: 'friend_ids',
  SENTIMENT: 'sentiment',
  SCORE: 'score',
  EMOJI: 'emoji',
  CREATED_AT: 'created_at',
  VISIBLE_TO: 'visible_to',
  ID: 'id',
  COMMENT_COUNT: 'comment_count',
  REACTION_COUNT: 'reaction_count',
  ALL_VILLAGE: 'all_village',
  IMAGE_PATHS: 'image_paths',
} as const;

// Field names for Group documents
export const GroupFields = {
  NAME: 'name',
  ICON: 'icon',
  MEMBERS: 'members',
  MEMBER_PROFILES: 'member_profiles',
  CREATED_AT: 'created_at',
} as const;

// Field names for Chat documents
export const ChatFields = {
  SENDER_ID: 'sender_id',
  TEXT: 'text',
  CREATED_AT: 'created_at',
  ATTACHMENTS: 'attachments',
} as const;

// Field names for Summary documents
export const InsightsFields = {
  EMOTIONAL_OVERVIEW: 'emotional_overview',
  KEY_MOMENTS: 'key_moments',
  RECURRING_THEMES: 'recurring_themes',
  PROGRESS_AND_GROWTH: 'progress_and_growth',
} as const;

// Field names for Device documents
export const DeviceFields = {
  DEVICE_ID: 'device_id',
  UPDATED_AT: 'updated_at',
} as const;

// Query operators
export const QueryOperators = {
  ARRAY_CONTAINS: 'array-contains',
  ARRAY_CONTAINS_ANY: 'array-contains-any',
  IN: 'in',
  EQUALS: '==',
  DESC: 'desc',
  ASC: 'asc',
} as const;

// Field names for UserSummary documents
export const UserSummaryFields = {
  CREATOR_ID: 'creator_id',
  TARGET_ID: 'target_id',
  SUMMARY: 'summary',
  SUGGESTIONS: 'suggestions',
  LAST_UPDATE_ID: 'last_update_id',
  CREATED_AT: 'created_at',
  UPDATED_AT: 'updated_at',
  UPDATE_COUNT: 'update_count',
} as const;

// Field names for Comment documents
export const CommentFields = {
  ID: 'id',
  CREATED_BY: 'created_by',
  CONTENT: 'content',
  CREATED_AT: 'created_at',
  UPDATED_AT: 'updated_at',
  PARENT_ID: 'parent_id',
} as const;

// Field names for Reaction documents
export const ReactionFields = {
  CREATED_BY: 'created_by',
  TYPE: 'type',
  CREATED_AT: 'created_at',
} as const;

// Field names for Feed documents
export const FeedFields = {
  UPDATE_ID: 'update_id',
  CREATED_AT: 'created_at',
  DIRECT_VISIBLE: 'direct_visible',
  FRIEND_ID: 'friend_id',
  GROUP_IDS: 'group_ids',
  CREATED_BY: 'created_by',
} as const;

// Field names for Nudge documents
export const NudgeFields = {
  SENDER_ID: 'sender_id',
  RECEIVER_ID: 'receiver_id',
  TIMESTAMP: 'timestamp',
} as const;

// Field names for Time Bucket documents
export const TimeBucketFields = {
  BUCKET_HOUR: 'bucket_hour',
  UPDATED_AT: 'updated_at',
} as const;

// Options for notification settings
export const NotificationFields = {
  ALL: 'all',
  URGENT: 'urgent',
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
    "See your recent updates' summary here! Spill more to get your insights and to share with your Village privately",
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

// Field names for Profile->Friends documents
export const FriendDocFields = {
  USERNAME: 'username',
  NAME: 'name',
  AVATAR: 'avatar',
  LAST_UPDATE_EMOJI: 'last_update_emoji',
  LAST_UPDATE_AT: 'last_update_at',
  CREATED_AT: 'created_at',
  UPDATED_AT: 'updated_at',
} as const;
