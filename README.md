# Setting Up the Functions Project

1. **Install Node.js and npm**
   - Download and install from [nodejs.org](https://nodejs.org/).

2. **Install Project Dependencies**
   ```sh
   cd functions
   npm install
   ```

3. **Build the Project**
   - Compile TypeScript to JavaScript:
     ```sh
     npm run build
     ```

4. **Linting & Formatting (Recommended)**
   - To lint code:
     ```sh
     npm run lint
     ```
   - To format code:
     ```sh
     npm run format
     ```

---

# Running Automated Tests Locally

Welcome! This guide will help you set up your environment to run the automated tests for this project. The tests interact with Firebase services and are designed to run against local emulators for safety and speed.

## Prerequisites

- **Python 3.x** (https://www.python.org/downloads/)
- **pip** (comes with Python)
- **Node.js & npm** (https://nodejs.org/)
- **Firebase CLI**  
  Install globally:  
  ```sh
  npm install -g firebase-tools
  ```

## 1. Install Python Dependencies

From the project root:

```sh
cd tests
pip install -r requirements.txt
```

## 2. Firebase Emulator Setup

Start all required emulators (Firestore, Auth, Functions, Hosting):

```sh
cd ..
firebase emulators:start
```

- This uses the configuration in `firebase.json`.
- Ensure ports 8080 (Firestore), 9099 (Auth), 5001 (Functions), and 5000 (Hosting) are available.
- The Emulator UI will be enabled for management.

## 3. Firestore Credentials & Service Account Setup

Some test scripts may require a Google service account JSON key (for `firebase_admin`).  
**If using only the emulator:**  
- Most scripts set `FIRESTORE_EMULATOR_HOST` to `localhost:8080` automatically.
- For full compatibility, set the following environment variable before running tests:
  ```sh
  set GOOGLE_APPLICATION_CREDENTIALS=path\to\dummy-service-account.json   # Windows
  export GOOGLE_APPLICATION_CREDENTIALS=path/to/dummy-service-account.json # Mac/Linux
  ```
- You can use a dummy JSON file for local emulator use. Example:
  ```json
  {
    "type": "service_account",
    "project_id": "demo-test",
    "private_key_id": "dummy",
    "private_key": "-----BEGIN PRIVATE KEY-----\nMII...\n-----END PRIVATE KEY-----\n",
    "client_email": "dummy@demo-test.iam.gserviceaccount.com",
    "client_id": "dummy",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/dummy%40demo-test.iam.gserviceaccount.com"
  }
  ```
- Place this file somewhere safe and reference its path as shown above.

## Note on AI Workflow Testing

For testing AI flows, copy `functions/.env.example` to `functions/.env` and provide any required API keys (such as `GEMINI_API_KEY`). This is only needed for local AI workflow tests, not for running the main backend tests.

## 4. Running the Tests

From the `tests` directory, run any script you wish to test:

```sh
python comments_automation.py
python deletion_automation.py
# ...etc.
```

Each script is independent and targets specific functionality.

## Deployment Process Overview

### Staging Deployment

- **Automatic:** Every time you push to the `main` branch, the latest code is automatically deployed to the staging environment.
- **What gets deployed:** Any changes to backend functions, frontend code, Firestore rules, or configuration are picked up and deployed.
- **Purpose:** Staging is where you can test your changes in an environment that closely matches production, before going live.

### Production Deployment

- **Manual:** Deployments to production are not automatic.
- **How to deploy:**
  1. **Create a Release:** In GitHub, create a new release and tag the commit you want to deploy.
  2. **Trigger Deploy:** Go to the GitHub Actions tab, find the "Firebase Production Deploy" workflow, and run it manually. You'll need to specify the release tag you just created.
- **Purpose:** This ensures only reviewed and tagged versions are deployed to production, adding an extra layer of control and safety.

If you're new, always test your changes in staging first. Production deploys should only be done after creating a release and confirming everything works as expected in staging.

## Managing Secrets for Deployment

For production (and optionally staging), sensitive values such as API keys must be set as Firebase function secrets. For example, to set the `GEMINI_API_KEY`:

```sh
firebase functions:secrets:set GEMINI_API_KEY
```

You will be prompted to enter the value securely. These secrets are used by your deployed functions and are not stored in source code.

## Troubleshooting

- **Emulator not running:** Make sure `firebase emulators:start` is active before running tests.
- **Service account errors:** Ensure `GOOGLE_APPLICATION_CREDENTIALS` points to a valid (even dummy) JSON file.
- **Dependency issues:** Double-check your Python and npm installations.

## Summary

1. Install dependencies
2. Start Firebase emulators
3. Set up (dummy) service account JSON if needed
4. Run tests from the `tests` directory

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
    "nudging_occurrence": "weekly",
    "has_gender": true,
    "goal": "stay_connected",
    "connect_to": "friends",
    "personality": "share_little",
    "tone": "light_and_casual"
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
  "nudging_settings": {
    "occurrence": "weekly",
    "times_of_day": ["09:00"],
    "days_of_week": ["monday"]
  },
  "gender": "male",
  "goal": "stay_connected",
  "connect_to": "friends",
  "personality": "share_little",
  "tone": "light_and_casual"
}
```

_Note: notification_settings is an optional array that can only contain "all" or "urgent". nudging_settings is an optional nested object with occurrence (daily/weekly/few_days/never), times_of_day (HH:MM format), and days_of_week. Validation rules: daily allows multiple times_of_day; weekly allows 1 time_of_day and 1 day_of_week; few_days allows 1 time_of_day and multiple days_of_week; never allows no times/days. goal and connect_to accept any string (free-form). personality can only contain predefined values. tone can only contain predefined values._

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
  "nudging_settings": {
    "occurrence": "weekly",
    "times_of_day": ["09:00"],
    "days_of_week": ["monday"]
  },
  "gender": "male",
  "summary": "",
  "suggestions": "",
  "insights": {
    "emotional_overview": "",
    "key_moments": "",
    "recurring_themes": "",
    "progress_and_growth": ""
  },
  "tone": "light_and_casual"
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
    "nudging_occurrence": "daily",
    "has_gender": true,
    "goal": "improve_relationships",
    "connect_to": "family",
    "personality": "share_big",
    "tone": "deep_and_reflective"
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
  "nudging_settings": {
    "occurrence": "daily",
    "times_of_day": ["08:00", "18:00"]
  },
  "gender": "male",
  "goal": "improve_relationships",
  "connect_to": "family",
  "personality": "share_big",
  "tone": "deep_and_reflective"
}
```

_Note: All fields are optional. Only the fields included in the request will be updated. notification_settings can only contain "all" or "urgent". nudging_settings is an optional nested object with occurrence (daily/weekly/few_days/never), times_of_day (HH:MM format), and days_of_week. Validation rules: daily allows multiple times_of_day; weekly allows 1 time_of_day and 1 day_of_week; few_days allows 1 time_of_day and multiple days_of_week; never allows no times/days. goal and connect_to accept any string (free-form). personality can only contain predefined values. tone can only contain predefined values._

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
  "nudging_settings": {
    "occurrence": "daily",
    "times_of_day": ["08:00", "18:00"]
  },
  "gender": "male",
  "summary": "Active user since January 2023",
  "suggestions": "Consider connecting with more friends in your area",
  "insights": {
    "emotional_overview": "Generally positive sentiment in updates",
    "key_moments": "Family vacation in June 2023",
    "recurring_themes": "Family, Travel, Work",
    "progress_and_growth": "Increased social connections by 25%"
  },
  "tone": "deep_and_reflective"
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
    "nudging_occurrence": "weekly",
    "has_gender": true,
    "goal": "stay_connected",
    "connect_to": "friends",
    "personality": "share_little",
    "tone": "light_and_casual"
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
  "nudging_settings": {
    "occurrence": "weekly",
    "times_of_day": ["09:00"],
    "days_of_week": ["monday"]
  },
  "gender": "male",
  "updated_at": "2025-03-18T18:51:39.000+00:00",
  "summary": "Active user since January 2023",
  "suggestions": "Consider connecting with more friends in your area",
  "insights": {
    "emotional_overview": "Generally positive sentiment in updates",
    "key_moments": "Family vacation in June 2023",
    "recurring_themes": "Family, Travel, Work",
    "progress_and_growth": "Increased social connections by 25%"
  },
  "tone": "light_and_casual"
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
    "invitation_count": 0,
    "has_name": true,
    "has_avatar": true,
    "has_location": true,
    "has_birthday": true,
    "has_notification_settings": true,
    "nudging_occurrence": "weekly",
    "has_gender": true,
    "goal": "stay_connected",
    "connect_to": "friends",
    "personality": "share_little",
    "tone": "light_and_casual"
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

_Note: Both parameters are optional. Default limit is 20 (min: 1, max: 100). after_cursor must be in base64 encoding based on a previous request._

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
      "score": 5,
      "emoji": "😊",
      "created_at": "2025-01-01T00:00:00.000+00:00",
      "comment_count": 0,
      "reaction_count": 0,
      "reactions": [
        {
          "type": "like",
          "count": 1,
          "reaction_id": "1234"
        }
      ],
      "all_village": false,
      "images": ["updates/update123/image1.jpg"]
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

_Note: Both parameters are optional. Default limit is 20 (min: 1, max: 100). after_cursor must be in base64 encoding based on a previous request._

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
      "score": 5,
      "emoji": "😊",
      "created_at": "2025-01-01T00:00:00.000+00:00",
      "comment_count": 0,
      "reaction_count": 0,
      "reactions": [
        {
          "type": "like",
          "count": 1,
          "reaction_id": "1234"
        }
      ],
      "all_village": false,
      "images": ["updates/update123/image1.jpg"],
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

_Note: Both parameters are optional. Default limit is 20 (min: 1, max: 100). after_cursor must be in base64 encoding based on a previous request._

**Output**:

```json
{
  "friends": [
    {
      "user_id": "friend123",
      "username": "janedoe",
      "name": "Jane Doe",
      "avatar": "https://example.com/avatar.jpg",
      "last_update_emoji": "😊"
    }
  ],
  "next_cursor": "aW52aXRhdGlvbnMvSHpKM0ZqUmprWjRqbHJPandhUFk="
}
```

**Errors**:

- 400: Invalid query parameters
- 404: Profile not found
- 500: Internal server error

#### GET /me/requests

**Purpose**: Get all join requests for the authenticated user's invitation, paginated.

**Analytics Events**:

- JOIN_REQUESTS_VIEWED: When a user views join requests for their invitation

  **Event Body:**

  ```json
  {
    "join_request_count": 0
  }
  ```

**Input**: Query Parameters

```
?limit=20&after_cursor=aW52aXRhdGlvbnMvSHpKM0ZqUmprWjRqbHJPandhUFk=
```

_Note: Both parameters are optional. Default limit is 20 (min: 1, max: 100). after_cursor must be in base64 encoding based on a previous request._

**Output**:

```json
{
  "join_requests": [
    {
      "request_id": "req123",
      "invitation_id": "abc123",
      "requester_id": "user456",
      "receiver_id": "user123",
      "status": "pending",
      "created_at": "2025-01-01T00:00:00.000+00:00",
      "updated_at": "2025-01-01T00:00:00.000+00:00",
      "requester_name": "Jane Doe",
      "requester_username": "janedoe",
      "requester_avatar": "https://example.com/avatar2.jpg",
      "receiver_name": "John Doe",
      "receiver_username": "johndoe",
      "receiver_avatar": "https://example.com/avatar.jpg"
    }
  ],
  "next_cursor": "aW52aXRhdGlvbnMvSHpKM0ZqUmprWjRqbHJPandhUFk="
}
```

**Errors**:

- 400: Invalid pagination parameters
- 403: You are not authorized to view these join requests
- 404: Invitation not found
- 500: Internal server error

#### GET /me/requests/:request_id

**Purpose**: Get a single join request by ID. The authenticated user must be either the sender or receiver of the join request.

**Analytics Events**:

- SINGLE_JOIN_REQUEST_VIEWED: When a specific join request is viewed

  **Event Body:**

  ```json
  {
    "invitation_id": "abc123",
    "request_id": "req123"
  }
  ```

**Input**: (None, uses auth token and request_id from path)

**Output**:

```json
{
  "request_id": "req123",
  "invitation_id": "abc123",
  "requester_id": "user456",
  "receiver_id": "user123",
  "status": "pending",
  "created_at": "2025-01-01T00:00:00.000+00:00",
  "updated_at": "2025-01-01T00:00:00.000+00:00",
  "requester_name": "Jane Doe",
  "requester_username": "janedoe",
  "requester_avatar": "https://example.com/avatar2.jpg",
  "receiver_name": "John Doe",
  "receiver_username": "johndoe",
  "receiver_avatar": "https://example.com/avatar.jpg"
}
```

**Errors**:

- 403: You are not authorized to view this join request
- 404: Join request not found
- 404: Invitation not found
- 500: Internal server error

### Updates

#### POST /updates

**Purpose**: Create a new update for the authenticated user. Images can be included by first uploading them to the staging bucket and providing the staging paths.

**Analytics Events**:

- UPDATE_CREATED: When a new update is created

  **Event Body:**

  ```json
  {
    "content_length": 0,
    "sentiment": "string",
    "score": 3,
    "friend_count": 0,
    "group_count": 0,
    "all_village": false,
    "image_count": 0
  }
  ```

**Input**:

```json
{
  "content": "Hello world!",
  "sentiment": "happy",
  "score": 5,
  "emoji": "😊",
  "group_ids": ["group123"],
  "friend_ids": ["friend123"],
  "all_village": false,
  "images": ["pending_uploads/user123/image1.jpg", "pending_uploads/user123/image2.png"]
}
```

_Note: group_ids, friend_ids, all_village, and images are optional. score and emoji are optional with default values of "3" and "😐" respectively. If all_village is set to true, the update will be shared with all of the user's friends and groups, ignoring the friend_ids and group_ids parameters. images should contain the paths of images previously uploaded to the staging bucket - these will be moved to the final location._

**Output**:

```json
{
  "update_id": "update123",
  "created_by": "user123",
  "content": "Hello world!",
  "group_ids": ["group123"],
  "friend_ids": ["friend123"],
  "sentiment": "happy",
  "score": 5,
  "emoji": "😊",
  "created_at": "2025-01-01T00:00:00.000+00:00",
  "comment_count": 0,
  "reaction_count": 0,
  "reactions": [
    {
      "type": "like",
      "count": 1,
      "reaction_id": "1234"
    }
  ],
  "all_village": false,
  "images": ["updates/update123/image1.jpg", "updates/update123/image2.png"]
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
  "score": 5,
  "emoji": "😊"
}
```

**Errors**:

- 400: Invalid request parameters
- 500: Internal server error

#### POST /updates/transcribe

**Purpose**: Transcribes audio data to text, and provides sentiment analysis for the transcribed text. This is useful for generating content for a new update from an audio recording.

**Analytics Events**:

- `AUDIO_TRANSCRIBED`: When audio is successfully transcribed.

  **Event Body:**

  ```json
  {
    "mime_type": "audio/wav",
    "transcription_length_characters": 150,
    "sentiment": "positive",
    "score": 4,
    "emoji": "😊"
  }
  ```

**Input**:

```json
{
  "audio_data": "<base64_encoded_audio_string>"
}
```

_Notes:_
- `audio_data` (string, required): Base64 encoded audio data.
- The raw audio data (before base64 encoding) can be uncompressed or compressed.
- Supported compression formats (auto-detected from the MIME type of the base64 decoded data): `gzip`, `deflate`, `brotli`.
  - Corresponding MIME types for compressed data: `application/gzip`, `application/x-gzip`, `application/deflate`, `application/brotli`.
- Supported audio formats for the *actual audio content* (auto-detected after any decompression):
  - `audio/x-aac` (AAC)
  - `audio/flac` (FLAC)
  - `audio/mp3` (MP3)
  - `audio/m4a` (M4A / MP4 Audio)
  - `audio/mpeg` (MPEG audio)
  - `audio/mpga` (MPEG audio)
  - `audio/mp4` (MP4 container with audio)
  - `audio/opus` (Opus)
  - `audio/pcm` (Raw PCM)
  - `audio/wav` (WAV)
  - `audio/webm` (WebM container with Opus/Vorbis audio)

**Output (Success - 200)**:

```json
{
  "transcription": "The transcribed text from the audio.",
  "sentiment": "positive",
  "score": 4,
  "emoji": "😊"
}
```

**Error Responses**:
- `400 Bad Request`:
  - If `audio_data` is missing or not a valid base64 string (Zod validation error).
  - If the MIME type of the (potentially decompressed) audio data cannot be determined.
  - If the (potentially decompressed) audio format is not supported.
  - If a compressed audio format is provided but is not one of the supported compression types (`gzip`, `deflate`, `brotli`).
  - If decompression fails (e.g., corrupted data).
- `401 Unauthorized`: If the Firebase ID token is missing, invalid, or expired.
- `500 Internal Server Error`: If the AI transcription flow fails or an unexpected server error occurs.

#### GET /updates/{update_id}

**Purpose**: Retrieve a single update with its comments. For retrieving more comments beyond the initial set, you can use the GET /updates/{update_id}/comments endpoint with pagination.

**Analytics Events**:

- UPDATES_VIEWED: When an update is viewed with its comments

  **Event Body:**

  ```json
  {
    "comment_count": 0,
    "reaction_count": 0,
    "unique_creators": 0,
    "user": "string"
  }
  ```

**Input**: Query Parameters

```
?limit=10&after_cursor=aW52aXRhdGlvbnMvSHpKM0ZqUmprWjRqbHJPandhUFk=
```

_Note: Both parameters are optional. Default limit is 20 (min: 1, max: 100). after_cursor must be in base64 encoding based on a previous request._

**Output**:

```json
{
  "update": {
    "update_id": "update123",
    "created_by": "user123",
    "content": "Hello world!",
    "group_ids": ["group123"],
    "friend_ids": ["friend123"],
    "sentiment": "happy",
    "score": 5,
    "emoji": "😊",
    "created_at": "2025-01-01T00:00:00.000+00:00",
    "comment_count": 2,
    "reaction_count": 1,
    "reactions": [
      {
        "type": "like",
        "count": 1,
        "reaction_id": "1234"
      }
    ],
    "all_village": false,
    "images": ["updates/update123/image1.jpg", "updates/update123/image2.png"],
    "username": "johndoe",
    "name": "John Doe",
    "avatar": "https://example.com/avatar.jpg"
  },
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

- 400: Update ID is required
- 400: Invalid query parameters
- 403: You don't have access to this update
- 404: Update not found
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

_Note: Both parameters are optional. Default limit is 20 (min: 1, max: 100). after_cursor must be in base64 encoding based on a previous request._

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

- 400: Update ID is required
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

- 400: Update ID is required
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

- 400: Update ID is required
- 400: Comment ID is required
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

- 400: Update ID is required
- 400: Comment ID is required
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

_Note: type is required and should be a valid reaction type (e.g., "like", "love", "laugh")._

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

- 400: Update ID is required
- 400: Invalid request parameters
- 400: You have already reacted with this type
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

- 400: Update ID is required
- 400: Reaction ID is required
- 403: You don't have access to this update
- 403: You can only delete your own reactions
- 404: Update not found
- 404: Reaction not found
- 500: Internal server error

### Invitations

#### GET /invitation

**Purpose**: Get the current user's persistent invitation link. If no invitation exists for the user, one will be created.

**Analytics Events**:

- INVITE_VIEWED: When a user views their invitation link

  **Event Body:**

  ```json
  {
    "friend_count": 0
  }
  ```

**Input**: (None, uses auth token)

**Output**:

```json
{
  "invitation_id": "abc123",
  "created_at": "2025-01-01T00:00:00.000+00:00",
  "sender_id": "user123",
  "username": "johndoe",
  "name": "John Doe",
  "avatar": "https://example.com/avatar.jpg"
}
```

**Errors**:

- 404: User profile not found
- 500: Internal server error

#### POST /invitation/reset

**Purpose**: Reset the user's invitation link by deleting the old one (including all join requests) and creating a new one.

**Analytics Events**:

- INVITE_RESET: When a user resets their invitation link

  **Event Body:**

  ```json
  {
    "friend_count": 0,
    "join_requests_deleted": 0
  }
  ```

**Input**: (None, uses auth token)

**Output**:

```json
{
  "invitation_id": "abc123",
  "created_at": "2025-01-01T00:00:00.000+00:00",
  "sender_id": "user123",
  "username": "johndoe",
  "name": "John Doe",
  "avatar": "https://example.com/avatar.jpg"
}
```

**Errors**:

- 404: User profile not found
- 500: Internal server error

#### POST /invitation/:invitation_id/join

**Purpose**: Create a join request for an invitation. The user must not have reached the combined limit of friends and active invitations (5).

**Analytics Events**:

- JOIN_REQUESTED: When a user requests to join via an invitation

  **Event Body:**

  ```json
  {
    "friend_count": 0
  }
  ```

**Input**: (None, uses auth token)

**Output**:

```json
{
  "request_id": "req123",
  "invitation_id": "abc123",
  "requester_id": "user456",
  "receiver_id": "user123",
  "status": "pending",
  "created_at": "2025-01-01T00:00:00.000+00:00",
  "updated_at": "2025-01-01T00:00:00.000+00:00",
  "requester_name": "Jane Doe",
  "requester_username": "janedoe",
  "requester_avatar": "https://example.com/avatar2.jpg",
  "receiver_name": "John Doe",
  "receiver_username": "johndoe",
  "receiver_avatar": "https://example.com/avatar.jpg"
}
```

**Errors**:

- 400: You cannot join your own invitation
- 400: User has reached the maximum number of friends and active invitations (5)
- 400: Sender has reached the maximum number of friends and active invitations (5)
- 404: Invitation not found
- 404: User profile not found
- 404: Sender profile not found
- 409: You are already friends with this user
- 409: Your previous join request was rejected. You cannot request to join again.
- 500: Internal server error

#### POST /invitation/:request_id/accept

**Purpose**: Accept a join request and create a friendship between the users.

**Analytics Events**:

- JOIN_ACCEPTED: When a join request is accepted

  **Event Body:**

  ```json
  {
    "friend_count": 0
  }
  ```

**Input**: (None, uses auth token)

**Output**:

```json
{
  "user_id": "user456",
  "username": "janedoe",
  "name": "Jane Doe",
  "avatar": "https://example.com/avatar2.jpg",
  "last_update_emoji": "😊"
}
```

**Errors**:

- 400: Join request is already accepted/rejected
- 403: You are not authorized to accept this join request
- 404: Join request not found
- 404: User profile not found
- 500: Internal server error

#### POST /invitation/:request_id/reject

**Purpose**: Reject a join request by setting its status to rejected.

**Analytics Events**:

- JOIN_REJECTED: When a join request is rejected

  **Event Body:**

  ```json
  {
    "friend_count": 0
  }
  ```

**Input**: (None, uses auth token)

**Output**:

```json
{
  "request_id": "req123",
  "invitation_id": "abc123",
  "requester_id": "user456",
  "receiver_id": "user123",
  "status": "rejected",
  "created_at": "2025-01-01T00:00:00.000+00:00",
  "updated_at": "2025-01-01T00:00:00.000+00:00",
  "requester_name": "Jane Doe",
  "requester_username": "janedoe",
  "requester_avatar": "https://example.com/avatar2.jpg",
  "receiver_name": "John Doe",
  "receiver_username": "johndoe",
  "receiver_avatar": "https://example.com/avatar.jpg"
}
```

**Errors**:

- 400: Join request is already accepted/rejected
- 403: You are not authorized to reject this join request
- 404: Join request not found
- 404: Invitation not found
- 500: Internal server error

#### GET /invitation/requests

**Purpose**: Get all join requests made by the current user, paginated.

**Analytics Events**:

- JOIN_REQUESTS_VIEWED: When a user views their join requests

  **Event Body:**

  ```json
  {
    "join_request_count": 0
  }
  ```

**Input**: Query Parameters

```
?limit=20&after_cursor=aW52aXRhdGlvbnMvSHpKM0ZqUmprWjRqbHJPandhUFk=
```

_Note: Both parameters are optional. Default limit is 20 (min: 1, max: 100). after_cursor must be in base64 encoding based on a previous request._

**Output**:

```json
{
  "join_requests": [
    {
      "request_id": "req123",
      "invitation_id": "abc123",
      "requester_id": "user456",
      "receiver_id": "user123",
      "status": "pending",
      "created_at": "2025-01-01T00:00:00.000+00:00",
      "updated_at": "2025-01-01T00:00:00.000+00:00",
      "requester_name": "Jane Doe",
      "requester_username": "janedoe",
      "requester_avatar": "https://example.com/avatar2.jpg",
      "receiver_name": "John Doe",
      "receiver_username": "johndoe",
      "receiver_avatar": "https://example.com/avatar.jpg"
    }
  ],
  "next_cursor": "aW52aXRhdGlvbnMvSHpKM0ZqUmprWjRqbHJPandhUFk="
}
```

**Errors**:

- 400: Invalid pagination parameters
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

#### PATCH /me/location

**Purpose**: Update the authenticated user's location information.

**Input**:

```json
{
  "location": "San Francisco, USA"
}
```

_Note: Location must be in the format "City, Country"._

**Output**:

```json
{
  "location": "San Francisco, USA",
  "updated_at": "2025-01-15T00:00:00.000+00:00"
}
```

**Errors**:

- 400: Invalid request parameters
- 401: Authentication required
- 500: Internal server error

#### PATCH /me/timezone

**Purpose**: Update the authenticated user's timezone and manage time bucket membership.

**Input**:

```json
{
  "timezone": "America/Los_Angeles"
}
```

_Note: Timezone must be a valid IANA timezone identifier (e.g., America/New_York, Asia/Dubai)._

**Output**:

```json
{
  "timezone": "America/Los_Angeles",
  "updated_at": "2025-01-15T00:00:00.000+00:00"
}
```

**Errors**:

- 400: Invalid request parameters
- 401: Authentication required
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
    "nudging_occurrence": "weekly",
    "has_gender": true,
    "goal": "stay_connected",
    "connect_to": "friends",
    "personality": "share_little",
    "tone": "light_and_casual"
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

- 400: Target user ID is required
- 400: Use /me/profile endpoint to view your own profile
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

_Note: Both parameters are optional. Default limit is 20 (min: 1, max: 100). after_cursor must be in base64 encoding based on a previous request._

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
      "score": 5,
      "emoji": "😊",
      "created_at": "2025-01-01T00:00:00.000+00:00",
      "comment_count": 0,
      "reaction_count": 0,
      "reactions": [
        {
          "type": "like",
          "count": 1,
          "reaction_id": "1234"
        }
      ],
      "all_village": false,
      "images": ["updates/update123/image1.jpg"]
    }
  ],
  "next_cursor": "aW52aXRhdGlvbnMvSHpKM0ZqUmprWjRqbHJPandhUFk="
}
```

**Errors**:

- 400: Target user ID is required
- 400: Use /me/updates endpoint to view your own updates
- 400: Invalid query parameters
- 403: You must be friends with this user to view their updates
- 404: Profile not found
- 500: Internal server error

#### POST /users/{user_id}/nudge

**Purpose**: Nudge another user to send an update. The authenticated user must be friends with the target user, and can only nudge the same user once per hour.

**Analytics Events**:

- USER_NUDGED: When a user successfully nudges another user

  **Event Body:**

  ```json
  {
    "target_user_id": "string"
  }
  ```

**Input**: (None, uses auth token)

**Output**:

```json
{
  "message": "Nudge sent successfully"
}
```

**Errors**:

- 400: Target user ID is required
- 400: You cannot nudge yourself
- 403: You must be friends with this user to nudge them
- 409: You can only nudge this user once per hour
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

_Note: If is_own_profile is false, emotional_overview, key_moments, recurring_themes, and progress_and_growth are not included in the context._

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
    "has_notification_settings": true,
    "nudging_occurrence": "weekly",
    "has_gender": true,
    "goal": "stay_connected",
    "connect_to": "friends",
    "personality": "share_little",
    "tone": "light_and_casual",
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

  - Background notifications are also sent with type `update_background` for silent app processing.

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

### Friendship Accepted (Firestore Trigger)

- **Trigger**: When a new document is created in the `friendships` collection with `status: "ACCEPTED"`.
- **Analytics Events**:

    - `FRIENDSHIP_ACCEPTED`: When a friendship invitation is accepted and a notification is sent (or attempted) to the sender.

  **Event Body:**

  ```json
  {
    "sender_has_name": true,
    "sender_has_avatar": true,
    "receiver_has_name": true,
    "receiver_has_avatar": true,
    "has_device": true
  }
  ```

### Comment Created (Firestore Trigger)

- **Trigger**: When a new document is created in the `comments` subcollection of an update.
- **Analytics Events**:

    - `COMMENT_NOTIFICATION_SENT`: When a notification is sent to the update creator about a new comment.

  **Event Body:**

  ```json
  {
    "notification_all": true,
    "notification_urgent": true,
    "no_notification": true,
    "no_device": true,
    "notification_length": 0,
    "is_urgent": true
  }
  ```

### Reaction Created (Firestore Trigger)

- **Trigger**: When a new document is created in the `reactions` subcollection of an update.
- **Analytics Events**:

    - `REACTION_NOTIFICATION_SENT`: When a notification is sent to the update creator about a new reaction.

  **Event Body:**

  ```json
  {
    "notification_all": true,
    "notification_urgent": true,
    "no_notification": true,
    "no_device": true,
    "notification_length": 0,
    "is_urgent": true
  }
  ```

### Join Request Created (Firestore Trigger)

- **Trigger**: When a new document is created in the `join_requests` subcollection of an invitation.
- **Analytics Events**:

    - `JOIN_REQUEST_NOTIFICATION_SENT`: When a notification is sent to the invitation owner about a new request.

  **Event Body:**

  ```json
  {
    "notification_all": true,
    "notification_urgent": true,
    "no_notification": true,
    "no_device": true,
    "notification_length": 0,
    "is_urgent": true
  }
  ```

    - Background notifications are also sent with type `join_request_background` for silent app processing.

### Join Request Updated (Firestore Trigger)

- **Trigger**: When a document is updated in the `join_requests` subcollection of an invitation.
- **Analytics Events**:

    - `JOIN_REQUEST_UPDATE_NOTIFICATION_SENT`: When a notification is sent to the requester about a rejection to join.

  **Event Body:**

  ```json
  {
    "notification_all": true,
    "notification_urgent": true,
    "no_notification": true,
    "no_device": true,
    "notification_length": 0,
    "is_urgent": true
  }
  ```

    - Background notifications are also sent with type `join_request_rejected_background` for silent app processing.

### Notifications (Hourly Scheduled Function)

- **Trigger**: Runs every hour. On each run it processes the current time bucket `${weekday}-${utcHour}`. If the bucket is empty, a fallback executes once per day at 14:00 UTC to nudge users not assigned to any bucket.
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

### Invitation Reminder Notification (Scheduled Function)

- **Trigger**: Runs at 12:00 PM UTC on every 3rd day of the month (cron: `0 12 */3 * *`).
- **Analytics Events**:

    - `INVITATION_NOTIFICATIONS_SENT` (Event Name in code: `EventName.INVITATION_NOTIFICATIONS_SENT`): An aggregate event summarizing the outcome of each scheduled run.

  **Event Body:**

  ```json
  {
    "total_users_count": 0,
    "notified_count": 0,
    "has_friends_count": 0,
    "no_timestamp_count": 0,
    "profile_too_new_count": 0,
    "no_device_count": 0
  }
  ```

    - `INVITATION_NOTIFICATION_SENT` (Event Name in code: `EventName.INVITATION_NOTIFICATION_SENT`): An event logged for each user profile processed.

  **Event Body:**

  ```json
  {
    "has_friends": true,
    "has_timestamp": true,
    "profile_too_new": false,
    "has_device": true
  }
  ```