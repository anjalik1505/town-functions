from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class GetPaginatedRequest(BaseModel):
    limit: Optional[int] = Field(default=20, ge=1, le=100)
    after_timestamp: Optional[str] = None

    @field_validator("after_timestamp")
    @classmethod
    def validate_timestamp(cls, v):
        if v is None:
            return v
        try:
            # Try to parse the timestamp in ISO format
            # This will accept formats like 2025-01-01T12:00:00Z or 2025-01-01T12:00:00.123Z
            datetime.fromisoformat(v.replace("Z", "+00:00"))
            return v
        except ValueError:
            raise ValueError(
                "after_timestamp must be a valid ISO format timestamp (e.g., 2025-01-01T12:00:00Z)"
            )

    class Config:
        extra = "ignore"


class AddFriendRequest(BaseModel):
    friend_id: str

    class Config:
        extra = "ignore"


class CreateInvitationRequest(BaseModel):
    # No additional fields needed for now

    class Config:
        extra = "ignore"


class InvitationActionRequest(BaseModel):
    invitation_id: str

    class Config:
        extra = "ignore"


class CreateChatMessageRequest(BaseModel):
    text: str
    attachments: Optional[List[str]] = None

    class Config:
        extra = "ignore"


class CreateGroupRequest(BaseModel):
    name: str
    icon: Optional[str] = None
    members: Optional[List[str]] = Field(default_factory=list)

    class Config:
        extra = "ignore"


class AddGroupMembersRequest(BaseModel):
    members: List[str]

    class Config:
        extra = "ignore"


class CreateUpdateRequest(BaseModel):
    content: str = Field(..., min_length=1)
    sentiment: str = Field(..., min_length=1)
    group_ids: Optional[List[str]] = Field(default_factory=list)
    friend_ids: Optional[List[str]] = Field(default_factory=list)

    @field_validator("group_ids", "friend_ids")
    @classmethod
    def validate_ids(cls, v):
        if v is None:
            return []
        return v

    class Config:
        extra = "ignore"


class CreateProfileRequest(BaseModel):
    username: str
    name: Optional[str] = None
    avatar: Optional[str] = None
    location: Optional[str] = None
    birthday: Optional[str] = None
    notification_settings: Optional[List[str]] = None

    class Config:
        extra = "ignore"


class UpdateProfileRequest(BaseModel):
    username: Optional[str] = None
    name: Optional[str] = None
    avatar: Optional[str] = None
    location: Optional[str] = None
    birthday: Optional[str] = None
    notification_settings: Optional[List[str]] = None

    class Config:
        extra = "ignore"


class UpdateDeviceRequest(BaseModel):
    device_id: str = Field(..., min_length=1)

    class Config:
        extra = "ignore"
