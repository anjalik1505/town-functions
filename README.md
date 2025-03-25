# Village Functions

This repository contains the backend functions for the Village application.

## API Documentation

### User Profiles

#### POST /me/profile
**Purpose**: Create a new profile for the authenticated user.

**Input**:
```json
{
  "username": "johndoe",
  "name": "John Doe",
  "avatar": "https://example.com/avatar.jpg",
  "location": "New York",
  "birthday": "1990-01-01",
  "notification_settings": ["messages", "updates"]
}
```

**Output**:
```json
{
  "user_id": "user123",
  "username": "johndoe",
  "name": "John Doe",
  "avatar": "https://example.com/avatar.jpg",
  "location": "New York",
  "birthday": "1990-01-01",
  "updated_at": "2025-03-18T18:51:39.000+00:00",
  "notification_settings": ["messages", "updates"],
  "summary": "",
  "suggestions": "",
  "insights": {
    "emotional_overview": "",
    "key_moments": "",
    "recurring_themes": "",
    "progress_and_growth": ""
  }
}
```

**Errors**:
- 400: Invalid request parameters
- 400: Profile already exists for user {user_id}
- 500: Internal server error

#### PUT /me/profile
**Purpose**: Update an existing profile for the authenticated user. When username, name, or avatar is updated, the changes are propagated to all related collections (invitations, friendships, and groups).

**Input**:
```json
{
  "username": "johndoe_updated",
  "name": "John Doe Updated",
  "avatar": "https://example.com/new_avatar.jpg",
  "location": "San Francisco",
  "birthday": "1990-01-01",
  "notification_settings": ["messages", "updates", "groups"]
}
```
*Note: All fields are optional. Only the fields included in the request will be updated.*

**Output**:
```json
{
  "user_id": "user123",
  "username": "johndoe_updated",
  "name": "John Doe Updated",
  "avatar": "https://example.com/new_avatar.jpg",
  "location": "San Francisco",
  "birthday": "1990-01-01",
  "updated_at": "2025-03-18T18:51:39.000+00:00",
  "notification_settings": ["messages", "updates", "groups"],
  "summary": "Active user since January 2023",
  "suggestions": "Consider connecting with more friends in your area",
  "insights": {
    "emotional_overview": "Generally positive sentiment in updates",
    "key_moments": "Family vacation in June 2023",
    "recurring_themes": "Family, Travel, Work",
    "progress_and_growth": "Increased social connections by 25%"
  }
}
```

**Errors**:
- 400: Invalid request parameters
- 404: Profile not found
- 500: Internal server error

#### GET /me/profile
**Purpose**: Retrieve the authenticated user's profile with insights information.

**Input**: (None, uses auth token)

**Output**:
```json
{
  "user_id": "user123",
  "username": "johndoe",
  "name": "John Doe",
  "avatar": "https://example.com/avatar.jpg",
  "location": "New York",
  "birthday": "1990-01-01",
  "notification_settings": ["messages", "updates"],
  "updated_at": "2025-03-18T18:51:39.000+00:00",
  "summary": "Active user since January 2023",
  "suggestions": "Consider connecting with more friends in your area",
  "insights": {
    "emotional_overview": "Generally positive sentiment in updates",
    "key_moments": "Family vacation in June 2023",
    "recurring_themes": "Family, Travel, Work",
    "progress_and_growth": "Increased social connections by 25%"
  }
}
```

**Errors**:
- 404: Profile not found
- 500: Internal server error

### User Data

#### GET /me/updates
**Purpose**: Get all updates of the authenticated user, paginated.

**Input**:
```json
{
  "limit": 20,
  "after_timestamp": "2025-01-01T12:00:00.000+00:00"
}
```
*Note: Both parameters are optional. Default limit is 20 (min: 1, max: 100).*

**Output**:
```json
{
  "updates": [
    {
      "update_id": "update123",
      "created_by": "user123",
      "content": "Hello world!",
      "group_ids": [],
      "friend_ids": [],
      "sentiment": "happy",
      "created_at": "2025-01-01T00:00:00.000+00:00"
    }
  ],
  "next_timestamp": "2025-01-01T00:00:00.000+00:00"
}
```

**Errors**:
- 400: Invalid request parameters
- 404: Profile not found
- 500: Internal server error

#### GET /me/feed
**Purpose**: Get all updates from the authenticated user's feed, paginated.

**Input**:
```json
{
  "limit": 20,
  "after_timestamp": "2025-01-01T12:00:00.000+00:00"
}
```
*Note: Both parameters are optional. Default limit is 20 (min: 1, max: 100).*

**Output**:
```json
{
  "updates": [
    {
      "update_id": "update123",
      "created_by": "user123",
      "content": "Hello world!",
      "group_ids": [],
      "friend_ids": [],
      "sentiment": "happy",
      "created_at": "2025-01-01T00:00:00.000+00:00"
    }
  ],
  "next_timestamp": "2025-01-01T00:00:00.000+00:00"
}
```

**Errors**:
- 400: Invalid request parameters
- 404: Profile not found
- 500: Internal server error

#### GET /me/friends
**Purpose**: Get all friends of the authenticated user.

**Input**: (None, uses auth token)

**Output**:
```json
{
  "friends": [
    {
      "user_id": "friend123",
      "username": "janedoe",
      "name": "Jane Doe",
      "avatar": "https://example.com/avatar.jpg"
    }
  ]
}
```

**Errors**:
- 404: Profile not found
- 500: Internal server error

### Updates

#### POST /updates
**Purpose**: Create a new update for the authenticated user.

**Input**:
```json
{
  "content": "Hello world!",
  "sentiment": "happy",
  "group_ids": ["group123"],
  "friend_ids": ["friend123"]
}
```
*Note: group_ids and friend_ids are optional.*

**Output**:
```json
{
  "update_id": "update123",
  "created_by": "user123",
  "content": "Hello world!",
  "group_ids": ["group123"],
  "friend_ids": ["friend123"],
  "sentiment": "happy",
  "created_at": "2025-01-01T00:00:00.000+00:00"
}
```

**Errors**:
- 400: Invalid request parameters
- 500: Internal server error

### Invitations

#### POST /invitations
**Purpose**: Create an invitation for a user to join the Village app.

**Input**: (None, uses auth token)

**Output**:
```json
{
  "invitation_id": "abc123",
  "created_at": "2025-01-01T00:00:00.000+00:00",
  "expires_at": "2025-01-02T00:00:00.000+00:00",
  "sender_id": "user123",
  "status": "pending",
  "username": "johndoe",
  "name": "John Doe",
  "avatar": "https://example.com/avatar.jpg"
}
```

**Errors**:
- 400: User has reached the maximum number of active invitations (5)
- 400: User has reached the maximum number of friends (5)
- 400: User profile not found
- 500: Internal server error

#### POST /invitations/{invitation_id}/accept
**Purpose**: Accept an invitation to connect with another user.

**Input**: (None, uses auth token)

**Output**:
```json
{
  "user_id": "user123",
  "username": "johndoe",
  "name": "John Doe",
  "avatar": "https://example.com/avatar.jpg"
}
```

**Errors**:
- 400: Invitation cannot be accepted (status: {status})
- 400: Invitation has expired
- 400: You cannot accept your own invitation
- 400: You have reached the maximum number of friends (5)
- 404: Invitation not found
- 404: User profile not found
- 404: Sender profile not found
- 500: Internal server error

#### POST /invitations/{invitation_id}/reject
**Purpose**: Reject an invitation from another user.

**Input**: (None, uses auth token)

**Output**:
```json
{
  "invitation_id": "abc123",
  "created_at": "2025-01-01T00:00:00.000+00:00",
  "expires_at": "2025-01-02T00:00:00.000+00:00",
  "sender_id": "user123",
  "status": "rejected",
  "username": "johndoe",
  "name": "John Doe",
  "avatar": "https://example.com/avatar.jpg"
}
```

**Errors**:
- 400: Invitation cannot be rejected (status: {status})
- 400: You cannot reject your own invitation
- 404: Invitation not found
- 500: Internal server error

#### POST /invitations/{invitation_id}/resend
**Purpose**: Resend an invitation by refreshing its timestamps.

**Input**: (None, uses auth token)

**Output**:
```json
{
  "invitation_id": "abc123",
  "created_at": "2025-01-01T00:00:00.000+00:00",
  "expires_at": "2025-01-02T00:00:00.000+00:00",
  "sender_id": "user123",
  "status": "pending",
  "username": "johndoe",
  "name": "John Doe",
  "avatar": "https://example.com/avatar.jpg"
}
```

**Errors**:
- 400: You have reached the maximum number of active invitations (5)
- 403: You can only resend your own invitations
- 404: Invitation not found
- 500: Internal server error

#### GET /invitations
**Purpose**: Get all invitations created by the current user.

**Input**: (None, uses auth token)

**Output**:
```json
{
  "invitations": [
    {
      "invitation_id": "abc123",
      "created_at": "2025-01-01T00:00:00.000+00:00",
      "expires_at": "2025-01-02T00:00:00.000+00:00",
      "sender_id": "user123",
      "status": "pending",
      "username": "johndoe",
      "name": "John Doe",
      "avatar": "https://example.com/avatar.jpg"
    }
  ]
}
```

**Errors**:
- 500: Internal server error

### Device Management

#### PUT /device
**Purpose**: Update the device ID for the authenticated user. This creates or updates a device document in the devices collection with the user ID as the document ID.

**Input**:
```json
{
  "device_id": "unique-device-identifier-string"
}
```

**Output**:
```json
{
  "device_id": "unique-device-identifier-string",
  "updated_at": "2025-01-15T00:00:00.000+00:00"
}
```

**Errors**:
- 400: Invalid request body
- 500: Internal server error

#### GET /device
**Purpose**: Retrieve the device information for the authenticated user.

**Input**: (None, uses auth token)

**Output**:
```json
{
  "device_id": "unique-device-identifier-string",
  "updated_at": "2025-01-15T00:00:00.000+00:00"
}
```

**Errors**:
- 404: Device not found
- 500: Internal server error

### User Profile

#### GET /users/{user_id}/profile
**Purpose**: Get another user's profile information. The authenticated user must be friends with the target user.

**Input**: (None, uses auth token)

**Output**:
```json
{
  "user_id": "user123",
  "username": "johndoe",
  "name": "John Doe",
  "avatar": "https://example.com/avatar.jpg",
  "location": "San Francisco",
  "birthday": "1990-01-01",
  "updated_at": "2025-03-18T18:51:39.000+00:00",
  "summary": "John Doe is a 35-year-old software engineer from San Francisco.",
  "suggestions": "Connect with this person to get insights into their life."
}
```

**Errors**:
- 403: You must be friends with this user to view their profile
- 404: Profile not found
- 500: Internal server error

#### GET /users/{user_id}/updates
**Purpose**: Get another user's updates. The authenticated user must be friends with the target user.

**Input**:
```json
{
  "limit": 20,
  "after_timestamp": "2025-01-01T12:00:00.000+00:00"
}
```
*Note: Both parameters are optional. Default limit is 20 (min: 1, max: 100).*

**Output**:
```json
{
  "updates": [
    {
      "update_id": "update123",
      "created_by": "user123",
      "content": "Hello world!",
      "group_ids": [],
      "friend_ids": [],
      "sentiment": "happy",
      "created_at": "2025-01-01T00:00:00.000+00:00"
    }
  ],
  "next_timestamp": "2025-01-01T00:00:00.000+00:00"
}
```

**Errors**:
- 400: Invalid request parameters
- 403: You must be friends with this user to view their updates
- 404: Profile not found
- 500: Internal server error

### Test Endpoints

#### POST /test/notification
**Purpose**: Send a test notification to the authenticated user's device.

**Input**:
```json
{
  "title": "Test Notification",
  "body": "This is a test notification message"
}
```

**Output**:
```json
{
  "success": true,
  "message": "Notification sent successfully",
  "messageId": "projects/village-staging-9178d/messages/1234567890"
}
```

**Errors**:
- 400: Invalid request parameters
- 404: Device not found. Please register a device first.
- 404: Device token not found. Please register a device first.
- 500: Internal server error

#### POST /test/prompt
**Purpose**: Test the AI prompt generation functionality for profile insights.

**Input**:
```json
{
  "summary": "Current profile summary",
  "suggestions": "Current profile suggestions",
  "update_content": "Content of the new update",
  "update_sentiment": "Sentiment of the new update",
  "is_own_profile": true,
  "prompt": "Custom prompt for the AI",
  "emotional_overview": "Current emotional overview",
  "key_moments": "Current key moments",
  "recurring_themes": "Current recurring themes",
  "progress_and_growth": "Current progress and growth",
  "gender": "they",
  "location": "User's location",
  "temperature": 0.7
}
```
*Note: If is_own_profile is false, emotional_overview, key_moments, recurring_themes, and progress_and_growth are not included in the context.*

**Output**:
```json
{
  "summary": "Updated profile summary",
  "suggestions": "Updated profile suggestions",
  "emotional_overview": "Updated emotional overview",
  "key_moments": "Updated key moments",
  "recurring_themes": "Updated recurring themes",
  "progress_and_growth": "Updated progress and growth"
}
```

**Errors**:
- 400: Invalid request parameters
- 500: Internal server error
