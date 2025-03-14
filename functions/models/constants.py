"""
Constants used throughout the application.
This file centralizes string literals to prevent typos and ensure consistency.
"""
from enum import StrEnum


# Collection names
class Collections(StrEnum):
    PROFILES = "profiles"
    SUMMARY = "summary"
    UPDATES = "updates"
    FRIENDSHIPS = "friendships"
    GROUPS = "groups"
    USER_SUMMARIES = "user_summaries"
    CHATS = "chats"
    SUMMARIES = "summaries"
    INVITATIONS = "invitations"


# Document names
class Documents(StrEnum):
    DEFAULT_SUMMARY = "default"


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
    ID = "id"
    NAME = "name"
    AVATAR = "avatar"
    EMAIL = "email"
    GROUP_IDS = "group_ids"


# Field names for Friend documents (Legacy)
class FriendFields(StrEnum):
    STATUS = "status"
    CREATED_AT = "created_at"
    FROM_USER = "from_user"


# Field names for Friendship documents
class FriendshipFields(StrEnum):
    SENDER_ID = "sender_id"
    SENDER_NAME = "sender_name"
    SENDER_AVATAR = "sender_avatar"
    RECEIVER_ID = "receiver_id"
    RECEIVER_NAME = "receiver_name"
    RECEIVER_AVATAR = "receiver_avatar"
    MEMBERS = "members"  # Array containing both sender_id and receiver_id for efficient queries
    STATUS = "status"
    CREATED_AT = "created_at"
    UPDATED_AT = "updated_at"
    EXPIRES_AT = "expires_at"


# Field names for Update documents
class UpdateFields(StrEnum):
    CREATED_BY = "created_by"
    CONTENT = "content"
    GROUP_IDS = "group_ids"
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
class SummaryFields(StrEnum):
    EMOTIONAL_JOURNEY = "emotional_journey"
    KEY_MOMENTS = "key_moments"
    RECURRING_THEMES = "recurring_themes"
    PROGRESS_AND_GROWTH = "progress_and_growth"
    SUGGESTIONS = "suggestions"
