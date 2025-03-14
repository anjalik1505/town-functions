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


@dataclass
class FriendsResponse:
    friends: List[Friend]

    def to_json(self):
        return asdict(self)


@dataclass
class GroupMember(BaseUser):
    """Group member with basic profile information."""
    pass


@dataclass
class GroupMemberProfile(BaseUser):
    """Group member with profile information."""
    pass


@dataclass
class GroupMembersResponse:
    members: List[GroupMember]

    def to_json(self):
        return asdict(self)


@dataclass
class AddFriendResponse:
    status: str
    message: str

    def to_json(self):
        return asdict(self)


@dataclass
class Group:
    groupId: str
    name: str
    icon: str
    created_at: str
    members: Optional[List[str]] = None
    member_profiles: Optional[List[Dict[str, str]]] = None


@dataclass
class GroupsResponse:
    groups: List[Group]

    def to_json(self):
        return asdict(self)
