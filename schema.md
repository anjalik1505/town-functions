Firestore Schema
1) profiles (collection)
   └── {userId} (document)
       ├── username: string
       ├── name: string
       ├── avatar: string
       ├── location: string
       ├── birthday: string
       ├── notification_settings: array<string>
       ├── summary: string
       ├── suggestions: string
       ├── last_update_id: string   # ID of the last update processed
       ├── updated_at: timestamp    # When the profile was last updated
       ├── group_ids: array<string>  # list of groupIds the user belongs to
       └── subcollections:
           └── insights (collection)
                └── {docId} (document, typically "default_insights")
                    ├── emotional_overview: string
                    ├── key_moments: string
                    ├── recurring_themes: string
                    ├── progress_and_growth: string

2) invitations (collection)  # For invitations (one-to-one or group)
   └── {invitationId} (document)
       ├── created_at: timestamp     # Server-side timestamp when created
       ├── expires_at: timestamp     # Server-side timestamp + X when created
       ├── sender_id: string         # User ID who sent the invitation
       ├── status: string            # "pending", "rejected", or "expired"
       ├── username: string          # Username of the user who sent the invitation
       ├── name: string              # Name of the user who sent the invitation
       └── avatar: string            # Avatar location of the user who sent the invitation

3) friendships (collection)
   └── {friendshipId} (document) # Typically userId1_userId2 where userIds are sorted
       ├── members: array<string>    # list of userIds (always 2)
       ├── sender_id: string (userId of sender)
       ├── sender_name: string
       ├── sender_username: string
       ├── sender_avatar: string
       ├── receiver_id: string (userId of receiver)
       ├── receiver_name: string
       ├── receiver_username: string
       ├── receiver_avatar: string
       ├── status: string ("pending", "accepted", "rejected", "expired")
       ├── created_at: timestamp
       └── updated_at: timestamp

4) devices (collection)  # For storing user device information
   └── {userId} (document)
       ├── device_id: string         # Unique device identifier
       └── updated_at: string        # ISO timestamp when the device was last updated

5) updates (collection)
   └── {updateId} (document)
       ├── created_by: string (userId)
       ├── group_ids: array<string>  # which groups the update is shared to
       ├── friend_ids: array<string> # which friends the update is shared to
       ├── visible_to: array<string> # INTERNAL: combined array of friend and group identifiers with prefixes
       ├── content: string           # text or processed speech-to-text
       ├── sentiment: string         # "happy", "sad", "neutral", "angry", "surprised"
       ├── created_at: timestamp
       ├── comment_count: number     # Number of comments on this update
       ├── reaction_count: number    # Number of reactions on this update
       └── subcollections:
           ├── comments (collection)
           │    └── {commentId} (document)
           │         ├── created_by: string (userId)
           │         ├── content: string
           │         ├── created_at: timestamp
           │         ├── updated_at: timestamp
           │         └── parent_id: string (commentId)
           └── reactions (collection)
                └── {reactionId} (document)
                     ├── created_by: string (userId)
                     ├── type: string    # e.g., "like", "love", "laugh", etc.
                     └── created_at: timestamp
       # Possibly location, attachments, etc.

6) user_summaries (collection)
   └── {relationshipId} (document)  # Sorted userIds concatenated e.g. userId1_userId2
       ├── creator_id: string       # User who created the update
       ├── target_id: string        # User who will see the summary
       ├── summary: string          # AI-generated summary of the relationship
       ├── suggestions: string      # AI-generated suggestions for interactions
       ├── last_update_id: string   # ID of the last update processed
       ├── created_at: timestamp    # When this summary was first created
       ├── updated_at: timestamp    # When this summary was last updated
       └── update_count: number     # Number of updates processed for this summary

7) groups (collection)
   └── {groupId} (document)
       ├── name: string
       ├── icon: string
       ├── members: array<string>    # list of userIds
       ├── member_profiles: array<object>  # Denormalized member data for efficient retrieval
       │    └── [
       │         {
       │           user_id: string,
       │           username: string,
       │           name: string,
       │           avatar: string
       │         },
       │         ...
       │        ]
       ├── created_at: timestamp
       └── subcollections:
           ├── user_summaries (collection)
           │    └── {userId} (document)
           │         ├── emotional_journey: string/map
           │         ├── key_moments: array or string
           │         ├── recurring_themes: array or string
           │         ├── progress_and_growth: string
           │         ├── suggestions: array<string> or map
           │         ├── updated_at: timestamp
           │         └── ...
           └── chats (collection)
                └── {messageId} (document)
                     ├── sender_id: string (userId)
                     ├── text: string
                     ├── created_at: timestamp
                     └── ...

8) chats (collection)   # For 1:1 chats only
   └── {chatId} (document)   # Sorted userIds concatenated e.g. userId1_userId_2
       ├── type: "one_to_one"
       ├── member_ids: array<string>  # exactly 2 for 1:1
       ├── created_at: timestamp
       └── subcollections:
            ├── messages (collection)
            │    └── {messageId} (document)
            │        ├── sender_id: string
            │        ├── text: string
            │        ├── created_at: timestamp
            │        └── ...
            └── summaries (collection)
                 └── {userId} (document)
                      ├── emotional_journey: string/map
                      ├── key_moments: array or string
                      ├── recurring_themes: array or string
                      ├── progress_and_growth: string
                      ├── suggestions: array<string> or map
                      ├── updated_at: timestamp
                      └── ...
