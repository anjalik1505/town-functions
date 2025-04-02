Below is a **concise** end-to-end summary of how to handle **multiple visibility channels** (direct user(s) + one or more groups) for a Firestore feed, **including** time-sorted queries, pagination, and properly separated comment threads.

---

## 1) Canonical “Updates” Collection

Store each update in a top-level `/updates/{updateId}` doc with core info:

```js
{
  content: "...",
  ownerId: "userXYZ",
  createdAt: Timestamp,
  // For reference/troubleshooting (not for queries):
  directUserIds: ["u123", "u456"], 
  groupIds: ["g987", "g654"]
}
```

- **No** heavy queries on `directUserIds` or `groupIds`.  
- This is just the “master record” for the update.

---

## 2) Fan Out to Users’ Feeds

Whenever a new update is created:

1. **Resolve** all audience members:
   - From `directUserIds[]` → add those users.  
   - From each `groupId` → fetch group membership, add those user IDs.  
2. **For each user** in the final audience, write a **feed item** in `/users/{userId}/feed/{feedItemId}`:

```js
{
  updateId: "abc123",
  createdAt: <Timestamp for sorting>,
  channelType: "direct" or "group",
  channelId: "g987" or "u123" // whichever channel the user sees it from
  // Possibly store minimal snippet of the update
}
```

> This ensures each user’s feed can be read with a **simple** query, rather than complex filters with Firestore’s array limitations.

---

## 3) Reading the Feed (with Pagination)

To load a user’s feed:

```js
db.collection("users")
  .doc(currentUserId)
  .collection("feed")
  .orderBy("createdAt", "desc")
  .limit(20)
  .get()
```

- For **pagination**: use the last document’s `createdAt` and call `startAfter()` for the next page.

Once the client has feed items, it can fetch the **full update** details from `/updates/{updateId}` if needed. (Or you could store all relevant update data inside each feed item to reduce extra lookups.)

---

## 4) Handling Comments by Channel

Because an update might be visible through different channels (e.g. direct vs. group), keep **channel-specific** comment threads. Two main ways:

### Option A: Separate Subcollections per Channel
- For each channel, store comments in a different subcollection:
  ```
  /updates/{updateId}/groupComments_{groupId}/
  /updates/{updateId}/directComments_{friendId}/
  ```
- When the user opens a feed item with `(channelType, channelId)`, load from the matching subcollection.

### Option B: Single `comments` Subcollection with a Channel Field
- Store comments in:
  ```
  /updates/{updateId}/comments/{commentId}
  ```
- Each comment doc includes:
  ```js
  {
    text: "...",
    author: "...",
    channelType: "group" | "direct",
    channelId: "g987" | "u123",
    createdAt: ...
  }
  ```
- **Query** only the relevant channel for that user’s view:
  ```js
  db.collection("updates/{updateId}/comments")
    .where("channelType", "==", channelType)
    .where("channelId", "==", channelId)
    .orderBy("createdAt", "asc")
  ```

Either approach ensures that comments posted in a “group” channel are **not** visible in a “direct” channel, and vice versa.

---

## Why This Works

- **Fan-out on write** avoids Firestore’s 10-item limit on `array-contains-any` queries.  
- Each user’s feed is a **simple** descending-time query.  
- Comments remain **siloed** by channel, so you don’t mix “group” and “direct” comments.  
- **Pagination** is straightforward with `startAfter()` on the feed’s `createdAt`.

---

### Final Takeaway

The **fan-out + channel labeling** strategy lets you handle multiple visibility channels (direct and groups) **and** keep comment threads properly separated, all while respecting Firestore’s query limits and providing a straightforward paginated feed query.