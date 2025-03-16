# Village Functions

This repository contains the backend functions for the Village application.

## API Documentation

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
  "username": "John Doe",
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
  "username": "John Doe",
  "avatar": "https://example.com/avatar.jpg",
  "status": "accepted"
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
  "username": "John Doe",
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
  "username": "John Doe",
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
      "username": "John Doe",
      "avatar": "https://example.com/avatar.jpg"
    }
  ]
}
```

**Errors**:
- 500: Internal server error
