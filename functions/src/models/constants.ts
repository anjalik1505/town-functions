// Constants for query operations
export const MAX_BATCH_SIZE = 10;
export const MAX_BATCH_OPERATIONS = 500;

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
  DEVICES: 'devices',
  COMMENTS: 'comments',
  REACTIONS: 'reactions',
  FEEDBACK: 'feedback',
  USER_FEEDS: 'user_feeds',
  FEED: 'feed'
} as const;

// Document names
export const Documents = {
  DEFAULT_INSIGHTS: 'default'
} as const;

// Status values
export const Status = {
  ACCEPTED: 'accepted',
  PENDING: 'pending',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  OK: 'ok',
  ERROR: 'error'
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
  GENDER: 'gender',
  GROUP_IDS: 'group_ids',
  INSIGHTS: 'insights',
  SUMMARY: 'summary',
  SUGGESTIONS: 'suggestions',
  LAST_UPDATE_ID: 'last_update_id',
  UPDATED_AT: 'updated_at'
} as const;

// Field names for Friendship documents
export const FriendshipFields = {
  SENDER_ID: 'sender_id',
  SENDER_USERNAME: 'sender_username',
  SENDER_NAME: 'sender_name',
  SENDER_AVATAR: 'sender_avatar',
  RECEIVER_ID: 'receiver_id',
  RECEIVER_USERNAME: 'receiver_username',
  RECEIVER_NAME: 'receiver_name',
  RECEIVER_AVATAR: 'receiver_avatar',
  MEMBERS: 'members',  // Array containing both sender_id and receiver_id for efficient queries
  STATUS: 'status',
  CREATED_AT: 'created_at',
  UPDATED_AT: 'updated_at',
  EXPIRES_AT: 'expires_at'
} as const;

// Field names for Invitation documents
export const InvitationFields = {
  CREATED_AT: 'created_at',
  EXPIRES_AT: 'expires_at',
  SENDER_ID: 'sender_id',
  STATUS: 'status',
  USERNAME: 'username',
  NAME: 'name',
  AVATAR: 'avatar',
  RECEIVER_NAME: 'receiver_name'
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
  REACTION_COUNT: 'reaction_count'
} as const;

// Field names for Group documents
export const GroupFields = {
  NAME: 'name',
  ICON: 'icon',
  MEMBERS: 'members',
  MEMBER_PROFILES: 'member_profiles',
  CREATED_AT: 'created_at'
} as const;

// Field names for Chat documents
export const ChatFields = {
  SENDER_ID: 'sender_id',
  TEXT: 'text',
  CREATED_AT: 'created_at',
  ATTACHMENTS: 'attachments'
} as const;

// Field names for Summary documents
export const InsightsFields = {
  EMOTIONAL_OVERVIEW: 'emotional_overview',
  KEY_MOMENTS: 'key_moments',
  RECURRING_THEMES: 'recurring_themes',
  PROGRESS_AND_GROWTH: 'progress_and_growth'
} as const;

// Field names for Device documents
export const DeviceFields = {
  DEVICE_ID: 'device_id',
  UPDATED_AT: 'updated_at'
} as const;

// Query operators
export const QueryOperators = {
  ARRAY_CONTAINS: 'array-contains',
  ARRAY_CONTAINS_ANY: 'array-contains-any',
  IN: 'in',
  EQUALS: '==',
  DESC: 'desc',
  ASC: 'asc'
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
  UPDATE_COUNT: 'update_count'
} as const;

// Field names for Comment documents
export const CommentFields = {
  ID: "id",
  CREATED_BY: "created_by",
  CONTENT: "content",
  CREATED_AT: "created_at",
  UPDATED_AT: "updated_at",
  PARENT_ID: "parent_id"
} as const;

// Field names for Reaction documents
export const ReactionFields = {
  CREATED_BY: "created_by",
  TYPE: "type",
  CREATED_AT: "created_at"
} as const;

// Field names for Feed documents
export const FeedFields = {
  UPDATE_ID: 'update_id',
  CREATED_AT: 'created_at',
  DIRECT_VISIBLE: 'direct_visible',
  FRIEND_ID: 'friend_id',
  GROUP_IDS: 'group_ids',
  CREATED_BY: 'created_by'
} as const;

// Options for notification settings
export const NotificationFields = {
  ALL: 'all',
  URGENT: 'urgent'
} as const;

// Placeholders for empty profile fields
export const Placeholders = {
  SUMMARY: "See your recent updates' summary here! Spill more to get your insights and to share with your Village privately",
  SUGGESTIONS: "Share more to get personalised suggestions",
  EMOTIONAL_OVERVIEW: "Give us a bit more to understand your emotional state",
  RECURRING_THEMES: "Too early to identify patterns, let's see what emerges here",
  KEY_MOMENTS: "Highs & lows? Spill the tea on the epic wins and the \"oof\" moments!",
  PROGRESS_AND_GROWTH: "Tell us more to see how you're leveling up and growing"
} as const;

// Unique parts for checking friend summary placeholders (robust against name changes)
export const FriendPlaceholderChecks = {
  SUMMARY_END: "to spill more so that you can get the inside scoop into their life",
  SUGGESTIONS_END: "to share more updates. More updates = better hangout suggestions online & offline!"
} as const;

// Templates for friend summary placeholders (requires name substitution)
export const FriendPlaceholderTemplates = {
  SUMMARY: "Ask <FRIEND_NAME> " + FriendPlaceholderChecks.SUMMARY_END,
  SUGGESTIONS: "Nudge <FRIEND_NAME> " + FriendPlaceholderChecks.SUGGESTIONS_END
} as const;