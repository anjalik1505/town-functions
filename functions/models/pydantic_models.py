from typing import Optional

from pydantic import BaseModel, Field


class GetPaginatedRequest(BaseModel):
    limit: Optional[int] = Field(default=20, ge=1, le=100)
    after_timestamp: Optional[str] = None

    class Config:
        extra = "ignore"


class AddFriendRequest(BaseModel):
    friendId: str

    class Config:
        extra = "ignore"
