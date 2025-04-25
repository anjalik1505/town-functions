# Village Functions

This repository contains the backend functions for the Village application.

## API Documentation

### User Profiles

#### POST /me/profile
**Purpose**: Create a new profile for the authenticated user.

**Analytics Events**:
- PROFILE_CREATED: When a new profile is successfully created

  **Event Body:**
  ```json
  {
    "has_name": true,
    "has_avatar": true,
    "has_location": true,
    "has_birthday": true,
    "has_notification_settings": true,
    "has_gender": true
  }
  ```

**Input**:
```json
{
  "username": "johndoe",
  "name": "John Doe",
  "avatar": "https://example.com/avatar.jpg",
  "location": "New York",
  "birthday": "1990-01-01",
  "notification_settings": ["all"],
  "gender": "male"
}
```
*Note: notification_settings is an optional array that can only contain "all" or "urgent".*

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
  "notification_settings": ["all"],
  "gender": "male",
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

**Analytics Events**:
- PROFILE_UPDATED: When a profile is successfully updated

  **Event Body:**
  ```json
  {
    "has_name": true,
    "has_avatar": true,
    "has_location": true,
    "has_birthday": true,
    "has_notification_settings": true,
    "has_gender": true
  }
  ```

**Input**:
```json
{
  "username": "johndoe_updated",
  "name": "John Doe Updated",
  "avatar": "https://example.com/new_avatar.jpg",
  "location": "San Francisco",
  "birthday": "1990-01-01",
  "notification_settings": ["urgent"],
  "gender": "male"
}
```
*Note: All fields are optional. Only the fields included in the request will be updated. notification_settings can only contain "all" or "urgent".*

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
  "notification_settings": ["urgent"],
  "gender": "male",
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

**Analytics Events**:
- PROFILE_VIEWED: When a user views their own profile

  **Event Body:**
  ```json
  {
    "has_name": true,
    "has_avatar": true,
    "has_location": true,
    "has_birthday": true,
    "has_notification_settings": true,
    "has_gender": true
  }
  ```

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
  "notification_settings": ["all"],
  "gender": "male",
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

#### DELETE /me/profile
**Purpose**: Delete the authenticated user's profile and all associated data. This triggers a cascade deletion of all user-related data including updates, friendships, invitations, and other associated content.

**Analytics Events**:
- PROFILE_DELETED: When a profile is successfully deleted

  **Event Body:**
  ```json
  {
    "update_count": 0,
    "feed_count": 0,
    "friend_count": 0,
    "summary_count": 0,
    "group_count": 0,
    "device_count": 0,
    "invitation_count": 0
  }
  ```

**Input**: (None, uses auth token)

**Output**: No content

**Status Code**: 204 (No Content)

**Errors**:
- 404: Profile not found for user {user_id}
- 500: Internal server error

### User Data

#### GET /me/updates
**Purpose**: Get all updates of the authenticated user, paginated.

**Analytics Events**:
- UPDATES_VIEWED: When a user views their own updates

  **Event Body:**
  ```json
  {
    "update_count": 0,
    "user": "string"
  }
  ```

**Input**: Query Parameters
```
?limit=20&after_cursor=aW52aXRhdGlvbnMvSHpKM0ZqUmprWjRqbHJPandhUFk=
```
*Note: Both parameters are optional. Default limit is 20 (min: 1, max: 100). after_cursor must be in base64 encoding based on a previous request.*

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
      "score": "5",
      "emoji": "😊",
      "created_at": "2025-01-01T00:00:00.000+00:00"
    }
  ],
  "next_cursor": "aW52aXRhdGlvbnMvSHpKM0ZqUmprWjRqbHJPandhUFk="
}
```

**Errors**:
- 400: Invalid query parameters
- 404: Profile not found
- 500: Internal server error

#### GET /me/question
**Purpose**: Get a personalized question to encourage the user to share an update. The question is generated based on the user's profile data, insights, and sharing history.

**Analytics Events**:
- QUESTION_GENERATED: When a personalized question is generated for a user

  **Event Body:**
  ```json
  {
    "question_length": 0
  }
  ```

**Input**: (None, uses auth token)

**Output**:
```json
{
  "question": "How has your recent work on the project been going? I noticed you mentioned some challenges last time."
}
```

**Errors**:
- 404: Profile not found
- 500: Internal server error

#### GET /me/feed
**Purpose**: Get all updates from the authenticated user's feed, paginated.

**Analytics Events**:
- FEED_VIEWED: When a user views their feed

  **Event Body:**
  ```json
  {
    "update_count": 0,
    "unique_creators": 0
  }
  ```

**Input**: Query Parameters
```
?limit=20&after_cursor=aW52aXRhdGlvbnMvSHpKM0ZqUmprWjRqbHJPandhUFk=
```
*Note: Both parameters are optional. Default limit is 20 (min: 1, max: 100). after_cursor must be in base64 encoding based on a previous request.*

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
      "score": "5",
      "emoji": "😊",
      "created_at": "2025-01-01T00:00:00.000+00:00",
      "username": "johndoe",
      "name": "John Doe",
      "avatar": "https://example.com/avatar.jpg"
    }
  ],
  "next_cursor": "aW52aXRhdGlvbnMvSHpKM0ZqUmprWjRqbHJPandhUFk="
}
```

**Errors**:
- 400: Invalid query parameters
- 404: Profile not found
- 500: Internal server error

#### GET /me/friends
**Purpose**: Get all friends of the authenticated user, paginated.

**Analytics Events**:
- FRIENDS_VIEWED: When a user views their friends list

  **Event Body:**
  ```json
  {
    "friend_count": 0
  }
  ```

**Input**: Query Parameters
```
?limit=20&after_cursor=aW52aXRhdGlvbnMvSHpKM0ZqUmprWjRqbHJPandhUFk=
```
*Note: Both parameters are optional. Default limit is 20 (min: 1, max: 100). after_cursor must be in base64 encoding based on a previous request.*

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
  ],
  "next_cursor": "aW52aXRhdGlvbnMvSHpKM0ZqUmprWjRqbHJPandhUFk="
}
```

**Errors**:
- 400: Invalid query parameters
- 404: Profile not found
- 500: Internal server error

### Updates

#### POST /updates
**Purpose**: Create a new update for the authenticated user.

**Analytics Events**:
- UPDATE_CREATED: When a new update is created

  **Event Body:**
  ```json
  {
    "content_length": 0,
    "sentiment": "string",
    "score": "string",
    "friend_count": 0,
    "group_count": 0,
    "all_village": false
  }
  ```

**Input**:
```json
{
  "content": "Hello world!",
  "sentiment": "happy",
  "score": "5",
  "emoji": "😊",
  "group_ids": ["group123"],
  "friend_ids": ["friend123"],
  "all_village": false
}
```
*Note: group_ids, friend_ids, and all_village are optional. score and emoji are optional with default values of "3" and "😐" respectively. If all_village is set to true, the update will be shared with all of the user's friends and groups, ignoring the friend_ids and group_ids parameters.*

**Output**:
```json
{
  "update_id": "update123",
  "created_by": "user123",
  "content": "Hello world!",
  "group_ids": ["group123"],
  "friend_ids": ["friend123"],
  "sentiment": "happy",
  "score": "5",
  "emoji": "😊",
  "created_at": "2025-01-01T00:00:00.000+00:00",
  "all_village": false
}
```

**Errors**:
- 400: Invalid request parameters
- 500: Internal server error

#### POST /updates/sentiment
**Purpose**: Analyze the sentiment of text content and return sentiment, score, and an emoji.

**Analytics Events**:
- SENTIMENT_ANALYZED: When sentiment analysis is performed on text

  **Event Body:**
  ```json
  {
    "sentiment": "string",
    "score": 0,
    "emoji": "string"
  }
  ```

**Input**:
```json
{
  "content": "I'm so happy today!"
}
```

**Output**:
```json
{
  "sentiment": "happy",
  "score": "5",
  "emoji": "😊"
}
```

**Errors**:
- 400: Invalid request parameters
- 500: Internal server error

### Comments

#### GET /updates/{update_id}/comments
**Purpose**: Get all comments for a specific update, paginated.

**Analytics Events**:
- COMMENTS_VIEWED: When comments for an update are viewed

  **Event Body:**
  ```json
  {
    "comment_count": 0,
    "reaction_count": 0,
    "unique_creators": 0
  }
  ```

**Input**: Query Parameters
```
?limit=20&after_cursor=aW52aXRhdGlvbnMvSHpKM0ZqUmprWjRqbHJPandhUFk=
```
*Note: Both parameters are optional. Default limit is 20 (min: 1, max: 100). after_cursor must be in base64 encoding based on a previous request.*

**Output**:
```json
{
  "comments": [
    {
      "comment_id": "comment123",
      "created_by": "user123",
      "content": "Great update!",
      "created_at": "2025-01-01T00:00:00.000+00:00",
      "updated_at": "2025-01-01T00:00:00.000+00:00",
      "username": "johndoe",
      "name": "John Doe",
      "avatar": "https://example.com/avatar.jpg"
    }
  ],
  "next_cursor": "aW52aXRhdGlvbnMvSHpKM0ZqUmprWjRqbHJPandhUFk="
}
```

**Status Code**: 200 (OK)

**Errors**:
- 400: Invalid query parameters
- 403: You don't have access to this update
- 404: Update not found
- 500: Internal server error

#### POST /updates/{update_id}/comments
**Purpose**: Create a new comment on an update.

**Analytics Events**:
- COMMENT_CREATED: When a new comment is created

  **Event Body:**
  ```json
  {
    "comment_length": 0,
    "comment_count": 0,
    "reaction_count": 0
  }
  ```

**Input**:
```json
{
  "content": "Great update!"
}
```

**Output**:
```json
{
  "comment_id": "comment123",
  "created_by": "user123",
  "content": "Great update!",
  "created_at": "2025-01-01T00:00:00.000+00:00",
  "updated_at": "2025-01-01T00:00:00.000+00:00",
  "username": "johndoe",
  "name": "John Doe",
  "avatar": "https://example.com/avatar.jpg"
}
```

**Status Code**: 201 (Created)

**Errors**:
- 400: Invalid request parameters
- 403: You don't have access to this update
- 404: Update not found
- 500: Internal server error

#### PUT /updates/{update_id}/comments/{comment_id}
**Purpose**: Update an existing comment.

**Analytics Events**:
- COMMENT_UPDATED: When a comment is updated

  **Event Body:**
  ```json
  {
    "comment_length": 0,
    "comment_count": 0,
    "reaction_count": 0
  }
  ```

**Input**:
```json
{
  "content": "Updated comment content"
}
```

**Output**:
```json
{
  "comment_id": "comment123",
  "created_by": "user123",
  "content": "Updated comment content",
  "created_at": "2025-01-01T00:00:00.000+00:00",
  "updated_at": "2025-01-01T00:00:00.000+00:00",
  "username": "johndoe",
  "name": "John Doe",
  "avatar": "https://example.com/avatar.jpg"
}
```

**Status Code**: 200 (OK)

**Errors**:
- 400: Invalid request parameters
- 403: You can only update your own comments
- 404: Update not found
- 404: Comment not found
- 500: Internal server error

#### DELETE /updates/{update_id}/comments/{comment_id}
**Purpose**: Delete a comment.

**Analytics Events**:
- COMMENT_DELETED: When a comment is deleted

  **Event Body:**
  ```json
  {
    "comment_length": 0,
    "comment_count": 0,
    "reaction_count": 0
  }
  ```

**Input**: (None, uses auth token)

**Output**: No content

**Status Code**: 204 (No Content)

**Errors**:
- 403: You can only delete your own comments
- 404: Update not found
- 404: Comment not found
- 500: Internal server error

### Reactions

#### POST /updates/{update_id}/reactions
**Purpose**: Create a new reaction on an update.

**Analytics Events**:
- REACTION_CREATED: When a new reaction is created

  **Event Body:**
  ```json
  {
    "reaction_count": 0,
    "comment_count": 0
  }
  ```

**Input**:
```json
{
  "type": "like"
}
```
*Note: type is required and should be a valid reaction type (e.g., "like", "love", "laugh").*

**Output**:
```json
{
  "type": "like",
  "count": 1,
  "reaction_id": "reaction123"
}
```

**Status Code**: 201 (Created)

**Errors**:
- 400: Invalid request parameters
- 403: You don't have access to this update
- 404: Update not found
- 500: Internal server error

#### DELETE /updates/{update_id}/reactions/{reaction_id}
**Purpose**: Delete a reaction from an update. The authenticated user must be the creator of the reaction.

**Analytics Events**:
- REACTION_DELETED: When a reaction is deleted

  **Event Body:**
  ```json
  {
    "reaction_count": 0,
    "comment_count": 0
  }
  ```

**Input**: (None, uses auth token)

**Output**:
```json
{
  "type": "like",
  "count": 0,
  "reaction_id": "reaction123"
}
```

**Status Code**: 200 (OK)

**Errors**:
- 400: You have already reacted with this type
- 403: You don't have access to this update
- 404: Update not found
- 500: Internal server error

### Invitations

#### POST /invitations
**Purpose**: Create an invitation for a user to join the Village app. The user must not have reached the combined limit of friends and active invitations (5).

**Analytics Events**:
- INVITE_CREATED: When a new invitation is created

  **Event Body:**
  ```json
  {
    "friend_count": 0,
    "invitation_count": 0
  }
  ```

**Input**:
```json
{
  "receiver_name": "John Doe"
}
```

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
  "avatar": "https://example.com/avatar.jpg",
  "receiver_name": "John Doe"
}
```

**Errors**:
- 400: Invalid request parameters
- 400: User has reached the maximum number of friends and active invitations (5)
- 404: User profile not found
- 500: Internal server error

#### POST /invitations/{invitation_id}/accept
**Purpose**: Accept an invitation to connect with another user. Both the sender and receiver must not have reached the combined limit of friends and active invitations (5).

**Analytics Events**:
- INVITE_ACCEPTED: When an invitation is accepted

  **Event Body:**
  ```json
  {
    "friend_count": 0,
    "invitation_count": 0
  }
  ```

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
- 400: You have reached the maximum number of friends and active invitations (5)
- 400: The sender has reached the maximum number of friends and active invitations (5)
- 404: Invitation not found
- 404: User profile not found
- 404: Sender profile not found
- 500: Internal server error

#### POST /invitations/{invitation_id}/reject
**Purpose**: Reject an invitation from another user.

**Analytics Events**:
- INVITE_REJECTED: When an invitation is rejected

  **Event Body:**
  ```json
  {
    "friend_count": 0,
    "invitation_count": 0
  }
  ```

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
  "avatar": "https://example.com/avatar.jpg",
  "receiver_name": "John Doe"
}
```

**Errors**:
- 400: Invitation cannot be rejected (status: {status})
- 400: You cannot reject your own invitation
- 404: Invitation not found
- 500: Internal server error

#### POST /invitations/{invitation_id}/resend
**Purpose**: Resend an invitation by refreshing its timestamps. The user must not have reached the combined limit of friends and active invitations (5). When resending, the current invitation is excluded from the limit count.

**Analytics Events**:
- INVITE_RESENT: When an invitation is resent

  **Event Body:**
  ```json
  {
    "friend_count": 0,
    "invitation_count": 0
  }
  ```

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
  "avatar": "https://example.com/avatar.jpg",
  "receiver_name": "John Doe"
}
```

**Errors**:
- 400: You have reached the maximum number of friends and active invitations (5)
- 403: You can only resend your own invitations
- 404: Invitation not found
- 500: Internal server error

#### GET /invitations
**Purpose**: Get all invitations created by the current user, paginated.

**Analytics Events**:
- INVITES_VIEWED: When a user views their invitations list

  **Event Body:**
  ```json
  {
    "friend_count": 0,
    "invitation_count": 0
  }
  ```

**Input**: Query Parameters
```
?limit=20&after_cursor=aW52aXRhdGlvbnMvSHpKM0ZqUmprWjRqbHJPandhUFk=
```
*Note: Both parameters are optional. Default limit is 20 (min: 1, max: 100). after_cursor must be in base64 encoding based on a previous request.*

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
      "avatar": "https://example.com/avatar.jpg",
      "receiver_name": "John Doe"
    }
  ],
  "next_cursor": "aW52aXRhdGlvbnMvSHpKM0ZqUmprWjRqbHJPandhUFk="
}
```

**Errors**:
- 400: Invalid query parameters
- 500: Internal server error

#### GET /invitations/{invitation_id}
**Purpose**: Get a single invitation by ID. The authenticated user must be the sender of the invitation.

**Analytics Events**:
- INVITE_VIEWED: When a specific invitation is viewed

  **Event Body:**
  ```json
  {
    "friend_count": 0,
    "invitation_count": 0
  }
  ```

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
  "avatar": "https://example.com/avatar.jpg",
  "receiver_name": "John Doe"
}
```

**Errors**:
- 403: You can only view your own invitations
- 404: Invitation not found

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

### Feedback

#### POST /feedback
**Purpose**: Create a new feedback entry from the authenticated user.

**Analytics Events**:
- FEEDBACK_CREATED: When new feedback is submitted

  **Event Body:**
  ```json
  {
    "feedback_length": 0
  }
  ```

**Input**:
```json
{
  "content": "This is my feedback about the app"
}
```

**Output**:
```json
{
  "feedback_id": "feedback123",
  "created_by": "user123",
  "content": "This is my feedback about the app",
  "created_at": "2025-01-01T00:00:00.000+00:00"
}
```

**Errors**:
- 400: Invalid request parameters
- 401: Authentication required
- 500: Internal server error

### User Profile

#### GET /users/{user_id}/profile
**Purpose**: Get another user's profile information. The authenticated user must be friends with the target user.

**Analytics Events**:
- FRIEND_PROFILE_VIEWED: When a friend's profile is viewed

  **Event Body:**
  ```json
  {
    "has_name": true,
    "has_avatar": true,
    "has_location": true,
    "has_birthday": true,
    "has_notification_settings": true,
    "has_gender": true
  }
  ```

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
  "gender": "male",
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

**Analytics Events**:
- FRIEND_UPDATES_VIEWED: When a friend's updates are viewed

  **Event Body:**
  ```json
  {
    "update_count": 0,
    "user": "string"
  }
  ```

**Input**: Query Parameters
```
?limit=20&after_cursor=aW52aXRhdGlvbnMvSHpKM0ZqUmprWjRqbHJPandhUFk=
```
*Note: Both parameters are optional. Default limit is 20 (min: 1, max: 100). after_cursor must be in base64 encoding based on a previous request.*

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
      "score": "5",
      "emoji": "😊",
      "created_at": "2025-01-01T00:00:00.000+00:00"
    }
  ],
  "next_cursor": "aW52aXRhdGlvbnMvSHpKM0ZqUmprWjRqbHJPandhUFk="
}
```

**Errors**:
- 400: Invalid query parameters
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

## Firestore Triggers & Scheduled Functions

### New Update Created (Firestore Trigger)
- **Trigger**: When a new document is created in the `updates` collection.
- **Analytics Events**:
  - `SUMMARY_CREATED`: When a summary is generated for the update.

  **Event Body:**
  ```json
  {
    "update_length": 0,
    "update_sentiment": "string",
    "summary_length": 0,
    "suggestions_length": 0,
    "emotional_overview_length": 0,
    "key_moments_length": 0,
    "recurring_themes_length": 0,
    "progress_and_growth_length": 0,
    "has_name": true,
    "has_avatar": true,
    "has_location": true,
    "has_birthday": true,
    "has_gender": true,
    "friend_summary_count": 0
  }
  ```
  - `FRIEND_SUMMARY_CREATED`: When a summary is generated for a friend.

  **Event Body:**
  ```json
  {
    "summary_length": 0,
    "suggestions_length": 0
  }
  ```

### Update Notification Sent (Firestore Trigger)
- **Trigger**: When a new document is created in the `updates` collection (notification logic).
- **Analytics Events**:
  - `NOTIFICATION_SENT`: When notifications are sent for a new update.

  **Event Body:**
  ```json
  {
    "notification_all": true,
    "notification_urgent": false,
    "no_notification": false,
    "no_device": false,
    "notification_length": 0,
    "is_urgent": false
  }
  ```

### Daily Notifications (Scheduled Function)
- **Trigger**: Runs daily at 14:00 UTC.
- **Analytics Events**:
  - `DAILY_NOTIFICATIONS_SENT`: When daily notifications are sent to all users.

  **Event Body:**
  ```json
  {
    "total_users_count": 0,
    "notification_all_count": 0,
    "notification_urgent_count": 0,
    "no_notification_count": 0,
    "no_device_count": 0
  }
  ```
  - `DAILY_NOTIFICATION_SENT`: When a daily notification is sent to a user.

  **Event Body:**
  ```json
  {
    "total_users_count": 0,
    "notification_all_count": 0,
    "notification_urgent_count": 0,
    "no_notification_count": 0,
    "no_device_count": 0
  }
  ```

### Profile Deleted (Firestore Trigger)
- **Trigger**: When a document is deleted in the `profiles` collection.
- **Analytics Events**:
  - `PROFILE_DELETED`: When a profile and all associated data are deleted.

  **Event Body:**
  ```json
  {
    "update_count": 0,
    "feed_count": 0,
    "friend_count": 0,
    "summary_count": 0,
    "group_count": 0,
    "device_count": 0,
    "invitation_count": 0
  }
  ```
