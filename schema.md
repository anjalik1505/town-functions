# Firestore Schema

This document describes the complete NoSQL database schema for Village Functions, validated against the actual implementation in the codebase.

## 1. profiles (collection)
**Path:** `/profiles/{userId}`  
**Document ID:** User's Firebase Auth UID

### Fields:
- `user_id` (string) - User's Firebase Auth UID
- `username` (string) - Unique username
- `name` (string) - Display name
- `avatar` (string) - Avatar URL
- `location` (string) - User location (format: "City, Country")
- `birthday` (string) - Birthday in ISO format (yyyy-mm-dd)
- `notification_settings` (array<string>) - Array of notification preferences (values: "all", "urgent")
- `nudging_settings` (object | null) - Settings for nudge notifications
  - `occurrence` (string) - Frequency: "daily", "weekly", "few_days", "never"
  - `times_of_day` (array<string>) - Times in HH:MM format (e.g., ["09:00", "18:00"])
  - `days_of_week` (array<string>) - Days when nudges should be sent
- `gender` (string) - Gender information
- `timezone` (string) - IANA timezone identifier (e.g., "America/New_York")
- `goal` (string) - User's goal: "stay_connected", "check_in", "improve_relationships", "meet_new_people", "not_sure"
- `connect_to` (string) - Who to connect with: "friends", "family", "partner", "new_people"
- `personality` (string) - Personality type: "share_little", "share_big", "keep_to_self", "share_more"
- `tone` (string) - Communication tone: "light_and_casual", "deep_and_reflective", "surprise_me"
- `summary` (string) - AI-generated profile summary
- `suggestions` (string) - AI-generated suggestions
- `group_ids` (array<string>) - IDs of groups the user belongs to
- `last_update_id` (string) - ID of user's last update
- `updated_at` (Timestamp) - When the profile was last updated
- `created_at` (Timestamp) - When the profile was created
- `limit_override` (number) - Override for friend limit

### Subcollections:
#### insights (subcollection)
**Path:** `/profiles/{userId}/insights/{docId}`  
**Document ID:** Typically "default"

- `emotional_overview` (string) - AI-generated emotional analysis
- `key_moments` (string) - Significant moments from updates
- `recurring_themes` (string) - Common themes in user's updates
- `progress_and_growth` (string) - Progress analysis

## 2. invitations (collection)
**Path:** `/invitations/{invitationId}`  
**Document ID:** Auto-generated

### Fields:
- `created_at` (Timestamp) - When the invitation was created
- `sender_id` (string) - User ID who sent the invitation
- `username` (string) - Username of the sender
- `name` (string) - Display name of the sender
- `avatar` (string) - Avatar URL of the sender

### Subcollections:
#### join_requests (subcollection)
**Path:** `/invitations/{invitationId}/join_requests/{requestId}`  
**Document ID:** Auto-generated

- `request_id` (string) - Request ID
- `invitation_id` (string) - Parent invitation ID
- `requester_id` (string) - User ID of requester
- `receiver_id` (string) - User ID of receiver (invitation owner)
- `status` (string) - "pending", "accepted", or "rejected"
- `created_at` (Timestamp) - When the request was created
- `updated_at` (Timestamp) - When the request was last updated
- `requester_name` (string) - Display name of requester
- `requester_username` (string) - Username of requester
- `requester_avatar` (string) - Avatar URL of requester
- `receiver_name` (string) - Display name of receiver
- `receiver_username` (string) - Username of receiver
- `receiver_avatar` (string) - Avatar URL of receiver

## 3. friendships (collection)
**Path:** `/friendships/{friendshipId}`  
**Document ID:** Sorted user IDs concatenated (e.g., "userId1_userId2")

### Fields:
- `sender_id` (string) - User ID of friend request sender
- `sender_name` (string) - Display name of sender
- `sender_username` (string) - Username of sender
- `sender_avatar` (string) - Avatar URL of sender
- `sender_last_update_emoji` (string) - Emoji from sender's last update
- `receiver_id` (string) - User ID of friend request receiver
- `receiver_name` (string) - Display name of receiver
- `receiver_username` (string) - Username of receiver
- `receiver_avatar` (string) - Avatar URL of receiver
- `receiver_last_update_emoji` (string) - Emoji from receiver's last update
- `members` (array<string>) - Array containing both user IDs [sender_id, receiver_id]
- `created_at` (Timestamp) - When the friendship was created
- `updated_at` (Timestamp) - When the friendship was last updated

## 4. devices (collection)
**Path:** `/devices/{userId}`  
**Document ID:** User's Firebase Auth UID

### Fields:
- `device_id` (string) - FCM token for push notifications
- `updated_at` (Timestamp) - When the device was last updated

## 5. updates (collection)
**Path:** `/updates/{updateId}`  
**Document ID:** Auto-generated

### Fields:
- `created_by` (string) - User ID of creator
- `content` (string) - Text content or transcribed audio
- `sentiment` (string) - Sentiment analysis result: "happy", "sad", "neutral", "angry", "surprised"
- `score` (number) - Sentiment score (1-5)
- `emoji` (string) - Emoji representing sentiment
- `created_at` (Timestamp) - When the update was created
- `group_ids` (array<string>) - IDs of groups shared with
- `friend_ids` (array<string>) - IDs of friends shared with
- `visible_to` (array<string>) - INTERNAL: Combined visibility identifiers for efficient querying
- `all_village` (boolean) - Whether shared with all friends and groups
- `image_paths` (array<string>) - URLs to attached images
- `comment_count` (number) - Number of comments on this update
- `reaction_count` (number) - Number of reactions on this update

### Subcollections:
#### comments (subcollection)
**Path:** `/updates/{updateId}/comments/{commentId}`  
**Document ID:** Auto-generated

- `id` (string) - Comment ID
- `created_by` (string) - User ID of commenter
- `content` (string) - Comment text
- `created_at` (Timestamp) - When the comment was created
- `updated_at` (Timestamp) - When the comment was last updated
- `parent_id` (string | null) - For nested comments (currently not used)

#### reactions (subcollection)
**Path:** `/updates/{updateId}/reactions/{reactionId}`  
**Document ID:** User ID of reactor (ensures one reaction per user)

- `created_by` (string) - User ID of reactor
- `type` (string) - Reaction type (e.g., "like", "love", "laugh", etc.)
- `created_at` (Timestamp) - When the reaction was created

## 6. user_summaries (collection)
**Path:** `/user_summaries/{summaryId}`  
**Document ID:** Sorted user IDs concatenated (e.g., "creatorId_targetId")

### Fields:
- `creator_id` (string) - User ID who created the updates
- `target_id` (string) - User ID who will see the summary
- `summary` (string) - AI-generated summary of updates
- `suggestions` (string) - AI-generated interaction suggestions
- `last_update_id` (string) - ID of the last update processed
- `created_at` (Timestamp) - When this summary was first created
- `updated_at` (Timestamp) - When this summary was last updated
- `update_count` (number) - Number of updates processed for this summary

## 7. groups (collection)
**Path:** `/groups/{groupId}`  
**Document ID:** Auto-generated

### Fields:
- `name` (string) - Group name
- `icon` (string) - Group icon/emoji
- `members` (array<string>) - Array of member user IDs
- `member_profiles` (array<object>) - Denormalized member data for efficient retrieval
  - Each element contains:
    - `user_id` (string)
    - `username` (string)
    - `name` (string)
    - `avatar` (string)
- `created_at` (Timestamp) - When the group was created

### Subcollections:
#### chats (subcollection)
**Path:** `/groups/{groupId}/chats/{messageId}`  
**Document ID:** Auto-generated

- `sender_id` (string) - User ID of message sender
- `text` (string) - Message text
- `created_at` (Timestamp) - When the message was sent
- `attachments` (array<string>) - URLs to message attachments

## 8. feedback (collection)
**Path:** `/feedback/{feedbackId}`  
**Document ID:** Auto-generated

### Fields:
- `created_by` (string) - User ID of feedback creator
- `content` (string) - Feedback text
- `created_at` (Timestamp) - When the feedback was created

## 9. user_feeds (collection)
**Path:** `/user_feeds/{userId}/feed/{updateId}`  
**Document ID (parent):** User's Firebase Auth UID  
**Document ID (feed item):** Update ID

### Fields:
- `update_id` (string) - ID of the update
- `created_at` (Timestamp) - When the update was created (for sorting)
- `direct_visible` (boolean) - Whether visible through direct friendship
- `friend_id` (string | null) - ID of friend who created update (if direct_visible is true)
- `group_ids` (array<string>) - IDs of groups through which update is visible
- `created_by` (string) - ID of update creator

## 10. nudges (collection)
**Path:** `/nudges/{nudgeId}`  
**Document ID:** Formatted as "{senderId}_{receiverId}"

### Fields:
- `sender_id` (string) - User ID of nudge sender
- `receiver_id` (string) - User ID of nudge receiver
- `timestamp` (Date) - When the nudge was sent

## 11. time_buckets (collection)
**Path:** `/time_buckets/{bucketId}`  
**Document ID:** Formatted as "{dayOfWeek}_{timeOfDay}" (e.g., "monday_09")

### Fields:
- `bucket_hour` (number) - Hour of the day (0-23)
- `updated_at` (Timestamp) - When the bucket was last updated

### Subcollections:
#### users (subcollection)
**Path:** `/time_buckets/{bucketId}/users/{userId}`  
**Document ID:** User's Firebase Auth UID

- `user_id` (string) - User ID
- `updated_at` (Timestamp) - When the user was added to this bucket

## Notes:

1. **Timestamps**: All timestamps are stored as Firestore Timestamp objects (not ISO strings in the database, but converted to ISO strings in API responses)
2. **Document IDs**: Most collections use auto-generated IDs except:
   - `profiles`, `devices`, `user_feeds` use the user's Firebase Auth UID
   - `friendships`, `user_summaries` use sorted concatenated user IDs
   - `nudges` use "{senderId}_{receiverId}" format
   - `time_buckets` use "{dayOfWeek}_{timeOfDay}" format
3. **Denormalization**: User profile data (username, name, avatar) is denormalized across multiple collections for performance
4. **Visibility**: The `visible_to` field in updates uses special identifiers for efficient querying
5. **Subcollections**: Comments, reactions, join_requests, and group chats are implemented as subcollections