"""
Constants used throughout the application.
This file centralizes string literals to prevent typos and ensure consistency.
"""
from enum import StrEnum


# Collection names
class Collections(StrEnum):
    PROFILES = "profiles"
    FRIENDS = "friends"
    SUMMARY = "summary"
    UPDATES = "updates"
    FRIEND_REQUESTS = "friend_requests"
    GROUPS = "groups"
    USER_SUMMARIES = "user_summaries"
    CHATS = "chats"
    SUMMARIES = "summaries"


# Document names
class Documents(StrEnum):
    DEFAULT_SUMMARY = "default"


# Status values
class Status(StrEnum):
    ACCEPTED = "accepted"
    PENDING = "pending"
    REJECTED = "rejected"
    OK = "ok"
    ERROR = "error"


# Field names for Profile documents
class ProfileFields(StrEnum):
    NAME = "name"
    AVATAR = "avatar"
    EMAIL = "email"
    GROUP_IDS = "group_ids"


# Field names for Friend documents
class FriendFields(StrEnum):
    STATUS = "status"
    CREATED_AT = "created_at"
    FROM_USER = "from_user"


# Field names for Update documents
class UpdateFields(StrEnum):
    CREATED_BY = "created_by"
    CONTENT = "content"
    GROUP_IDS = "group_ids"
    SENTIMENT = "sentiment"
    CREATED_AT = "created_at"


# Field names for Summary documents
class SummaryFields(StrEnum):
    EMOTIONAL_JOURNEY = "emotional_journey"
    KEY_MOMENTS = "key_moments"
    RECURRING_THEMES = "recurring_themes"
    PROGRESS_AND_GROWTH = "progress_and_growth"
    SUGGESTIONS = "suggestions"
