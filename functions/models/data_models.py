from dataclasses import dataclass, asdict
from typing import List, Optional, Dict


@dataclass
class Update:
    updateId: str
    created_by: str
    content: str
    group_ids: List[str]
    sentiment: int
    created_at: str


@dataclass
class FeedResponse:
    updates: List[Update]
    next_timestamp: Optional[str] = None

    def to_json(self):
        return asdict(self)


@dataclass
class UpdatesResponse:
    updates: List[Update]
    next_timestamp: Optional[str] = None

    def to_json(self):
        return asdict(self)


@dataclass
class Summary:
    emotional_journey: str
    key_moments: str
    recurring_themes: str
    progress_and_growth: str


@dataclass
class BaseUser:
    """Base class for user-related models with common fields."""

    id: str
    name: str
    avatar: str


@dataclass
class ProfileResponse(BaseUser):
    summary: Summary
    suggestions: list[str]

    def to_json(self):
        return asdict(self)


@dataclass
class Friend(BaseUser):
    status: str

    def __post_init__(self):
        # Ensure status is always a string, not an enum
        if hasattr(self.status, "value"):
            self.status = self.status.value

    def to_json(self):
        return asdict(self)


@dataclass
class FriendsResponse:
    friends: List[Friend]

    def to_json(self):
        return asdict(self)


@dataclass
class GroupMember(BaseUser):
    """Group member with basic profile information."""



@dataclass
class GroupMembersResponse:
    members: List[GroupMember]

    def to_json(self):
        return asdict(self)


@dataclass
class Group:
    group_id: str
    name: str
    icon: str
    created_at: str
    members: Optional[List[str]] = None
    member_profiles: Optional[List[Dict[str, str]]] = None

    def __post_init__(self):
        # Ensure any potential enum values are converted to strings
        if self.members is None:
            self.members = []
        if self.member_profiles is None:
            self.member_profiles = []

        # Convert any enum values in member_profiles to strings
        for profile in self.member_profiles:
            for key, value in profile.items():
                if hasattr(value, "value"):
                    profile[key] = value.value

    def to_json(self):
        return asdict(self)


@dataclass
class GroupsResponse:
    groups: List[Group]

    def to_json(self):
        return asdict(self)


@dataclass
class ChatMessage:
    message_id: str
    sender_id: str
    text: str
    created_at: str
    attachments: Optional[List[str]] = None

    def __post_init__(self):
        if self.attachments is None:
            self.attachments = []

    def to_dict(self):
        return asdict(self)


@dataclass
class ChatResponse:
    messages: List[ChatMessage]
    next_timestamp: Optional[str] = None

    def to_json(self):
        return asdict(self)
