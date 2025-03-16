Firestore Schema
1) profiles (collection)
   └── {userId} (document)
       ├── name: string
       ├── avatar: string
       ├── email: string
       ├── group_ids: array<string>  # list of groupIds the user belongs to
       ├── ... (other user properties, e.g., preferences)
       └── subcollections:
           └── summary (collection or single doc)
                └── {docId}
                    ├── emotional_journey: string or map
                    ├── key_moments: array or string
                    ├── recurring_themes: array or string
                    ├── progress_and_growth: string
                    ├── suggestions: array<string> or map
                    ├── updated_at: timestamp
                    └── ...

2) friendships (collection)
   └── {friendshipId} (document)
       ├── members: array<string>    # list of userIds
       ├── sender_id: string (userId of sender)
       ├── sender_name: string
       ├── sender_avatar: string
       ├── receiver_id: string (userId of receiver, empty for invitations)
       ├── receiver_name: string (empty for invitations)
       ├── receiver_avatar: string (empty for invitations)
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
       │           id: string,
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
                      ├── emotational_journey: string/map
                      ├── key_moments: array or string
                      ├── recurring_themes: array or string
                      ├── progress_and_growth: string
                      ├── suggestions: array<string> or map
                      ├── updated_at: timestamp
                      └── ...
    
6) invitations (collection)  # For generated invite tokens/links
   └── {inviteId} (document)
       ├── invited_by: string (userId)
       ├── email: string (invitee's email)
       ├── used: boolean
       ├── created_at: timestamp
       ├── expires_at: timestamp
       └── ... (any extra fields)
