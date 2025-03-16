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
       ├── group_ids: array<string>  # list of groupIds the user belongs to
       └── subcollections:
           └── insights (collection)
                └── {docId} (document, typically "default_insights")
                    ├── emotional_overview: string
                    ├── key_moments: string
                    ├── recurring_themes: string
                    ├── progress_and_growth: string

2) friendships (collection)
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

3) groups (collection)
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

4) updates (collection)
   └── {updateId} (document)
       ├── created_by: string (userId)
       ├── group_ids: array<string>  # which groups the update is shared to
       ├── content: string           # text or processed speech-to-text
       ├── sentiment: number (1-5 or similar)
       ├── created_at: timestamp
       └── ...
       # Possibly location, attachments, etc.

5) chats (collection)   # For 1:1 chats only
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

6) invitations (collection)  # For invitations (one-to-one or group)
   └── {invitationId} (document)
       ├── created_at: timestamp     # Server-side timestamp when created
       ├── expires_at: timestamp     # Server-side timestamp + X when created
       ├── sender_id: string         # User ID who sent the invitation
       ├── status: string            # "pending", "rejected", or "expired"
       ├── username: string          # Username of the user who sent the invitation
       ├── name: string              # Name of the user who sent the invitation
       └── avatar: string            # Avatar location of the user who sent the invitation
