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
- 404: Profile not found for user {user_id}
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

### Invitations

#### POST /invitations
**Purpose**: Create an invitation for a user to join the Village app.

**Input**: (None, uses auth token)

**Output**:
```json
{
  "invitation_id": "abc123",
  "created_at": "2023-01-01T00:00:00Z",
  "expires_at": "2023-01-02T00:00:00Z",
  "sender_id": "user123",
  "status": "pending",
  "username": "johndoe",
  "name": "John Doe",
  "avatar": "https://example.com/avatar.jpg"
}
```

**Errors**:
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
  "created_at": "2023-01-01T00:00:00Z",
  "expires_at": "2023-01-02T00:00:00Z",
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
  "created_at": "2023-01-01T00:00:00Z",
  "expires_at": "2023-01-02T00:00:00Z",
  "sender_id": "user123",
  "status": "pending",
  "username": "johndoe",
  "name": "John Doe",
  "avatar": "https://example.com/avatar.jpg"
}
```

**Errors**:
- 400: You can only resend your own invitations
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
      "created_at": "2023-01-01T00:00:00Z",
      "expires_at": "2023-01-02T00:00:00Z",
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
