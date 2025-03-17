from dataclasses import asdict, dataclass
from typing import Dict, List, Optional


@dataclass
class Update:
    update_id: str
    created_by: str
    content: str
    sentiment: str
    created_at: str
    group_ids: Optional[List[str]] = None
    friend_ids: Optional[List[str]] = None
    
    def to_json(self):
        return asdict(self)


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
class Insights:
    emotional_overview: str
    key_moments: str
    recurring_themes: str
    progress_and_growth: str


@dataclass
class BaseUser:
    """Base class for user-related models with common fields."""

    user_id: str
    username: str
    name: Optional[str] = None
    avatar: Optional[str] = None


@dataclass
class ProfileResponse(BaseUser):
    location: Optional[str] = None
    birthday: Optional[str] = None
    notification_settings: Optional[List[str]] = None
    summary: Optional[str] = None
    insights: Optional[Insights] = None
    suggestions: Optional[str] = None

    def to_json(self):
        return asdict(self)


@dataclass
class Friend(BaseUser):

    def to_json(self):
        return asdict(self)


@dataclass
class FriendsResponse:
    friends: List[Friend]

    def to_json(self):
        return asdict(self)


@dataclass
class Invitation:
    invitation_id: str
    created_at: str
    expires_at: str
    sender_id: str
    status: str
    username: str
    name: Optional[str] = None
    avatar: Optional[str] = None

    def __post_init__(self):
        # Ensure status is always a string, not an enum
        if hasattr(self.status, "value"):
            self.status = self.status.value

    def to_json(self):
        return asdict(self)


@dataclass
class InvitationsResponse:
    invitations: List[Invitation]

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


@dataclass
class Device:
    device_id: str
    updated_at: str

    def to_json(self):
        return asdict(self)
