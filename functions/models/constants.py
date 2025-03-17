from enum import StrEnum


# Collection names
class Collections(StrEnum):
    PROFILES = "profiles"
    UPDATES = "updates"
    FRIENDSHIPS = "friendships"
    GROUPS = "groups"
    USER_SUMMARIES = "user_summaries"
    CHATS = "chats"
    INSIGHTS = "insights"
    INVITATIONS = "invitations"
    DEVICES = "devices"


# Document names
class Documents(StrEnum):
    DEFAULT_INSIGHTS = "default"


# Status values
class Status(StrEnum):
    ACCEPTED = "accepted"
    PENDING = "pending"
    REJECTED = "rejected"
    EXPIRED = "expired"
    OK = "ok"
    ERROR = "error"


# Field names for Profile documents
class ProfileFields(StrEnum):
    USER_ID = "user_id"
    NAME = "name"
    USERNAME = "username"
    AVATAR = "avatar"
    LOCATION = "location"
    BIRTHDAY = "birthday"
    NOTIFICATION_SETTINGS = "notification_settings"
    GROUP_IDS = "group_ids"
    INSIGHTS = "insights"
    SUMMARY = "summary"
    SUGGESTIONS = "suggestions"


# Field names for Friend documents (Legacy)
class FriendFields(StrEnum):
    STATUS = "status"
    CREATED_AT = "created_at"
    FROM_USER = "from_user"


# Field names for Friendship documents
class FriendshipFields(StrEnum):
    SENDER_ID = "sender_id"
    SENDER_USERNAME = "sender_username"
    SENDER_NAME = "sender_name"
    SENDER_AVATAR = "sender_avatar"
    RECEIVER_ID = "receiver_id"
    RECEIVER_USERNAME = "receiver_username"
    RECEIVER_NAME = "receiver_name"
    RECEIVER_AVATAR = "receiver_avatar"
    MEMBERS = "members"  # Array containing both sender_id and receiver_id for efficient queries
    STATUS = "status"
    CREATED_AT = "created_at"
    UPDATED_AT = "updated_at"
    EXPIRES_AT = "expires_at"


# Field names for Invitation documents
class InvitationFields(StrEnum):
    CREATED_AT = "created_at"
    EXPIRES_AT = "expires_at"
    SENDER_ID = "sender_id"
    STATUS = "status"
    USERNAME = "username"
    NAME = "name"
    AVATAR = "avatar"


# Field names for Update documents
class UpdateFields(StrEnum):
    CREATED_BY = "created_by"
    CONTENT = "content"
    GROUP_IDS = "group_ids"
    FRIEND_IDS = "friend_ids"
    SENTIMENT = "sentiment"
    CREATED_AT = "created_at"


# Field names for Group documents
class GroupFields(StrEnum):
    NAME = "name"
    ICON = "icon"
    MEMBERS = "members"
    MEMBER_PROFILES = "member_profiles"
    CREATED_AT = "created_at"


# Field names for Chat documents
class ChatFields(StrEnum):
    SENDER_ID = "sender_id"
    TEXT = "text"
    CREATED_AT = "created_at"
    ATTACHMENTS = "attachments"


# Field names for Summary documents
class InsightsFields(StrEnum):
    EMOTIONAL_OVERVIEW = "emotional_overview"
    KEY_MOMENTS = "key_moments"
    RECURRING_THEMES = "recurring_themes"
    PROGRESS_AND_GROWTH = "progress_and_growth"


# Field names for Device documents
class DeviceFields(StrEnum):
    DEVICE_ID = "device_id"
    UPDATED_AT = "updated_at"


class QueryOperators(StrEnum):
    ARRAY_CONTAINS = "array_contains"
    ARRAY_CONTAINS_ANY = "array_contains_any"
    IN = "in"
    EQUALS = "=="
    LESS_THAN = "<"
    LESS_THAN_OR_EQUAL_TO = "<="


# Constants for query operations
MAX_BATCH_SIZE = 10
