from dataclasses import dataclass, asdict
from typing import List, Optional


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
class SelfSummary:
    emotional_journey: str
    key_moments: str
    recurring_themes: str
    progress_and_growth: str


@dataclass
class ProfileResponse:
    id: str
    name: str
    avatar: str
    group_ids: list[str]
    self_summary: SelfSummary
    suggestions_for_self: list[str]

    def to_json(self):
        return asdict(self)


@dataclass
class Friend:
    id: str
    name: str
    avatar: str


@dataclass
class FriendsResponse:
    friends: List[Friend]

    def to_json(self):
        return asdict(self)


@dataclass
class AddFriendResponse:
    status: str
    message: str

    def to_json(self):
        return asdict(self)
