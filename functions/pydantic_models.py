from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, field_validator


class GetPaginatedRequest(BaseModel):
    limit: Optional[int] = Field(default=20, ge=1, le=100)
    after_timestamp: Optional[str] = None

    @field_validator('after_timestamp')
    @classmethod
    def validate_timestamp(cls, v):
        if v is None:
            return v
        try:
            # Try to parse the timestamp in ISO format
            # This will accept formats like 2025-01-01T12:00:00Z or 2025-01-01T12:00:00.123Z
            datetime.fromisoformat(v.replace('Z', '+00:00'))
            return v
        except ValueError:
            raise ValueError("after_timestamp must be a valid ISO format timestamp (e.g., 2025-01-01T12:00:00Z)")

    class Config:
        extra = "ignore"


class AddFriendRequest(BaseModel):
    friendId: str

    class Config:
        extra = "ignore"
