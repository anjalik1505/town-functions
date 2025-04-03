# TypeScript Implementation Guidelines for Firebase Functions

> **Note:**  
> These instructions are **strict** requirements.  
> **Do not** deploy code automatically. Any code generated should be manually verified before deployment.

---

## 1. Project Structure

- **Standardized Organization**  
  - Follow this project structure:
    ```
    functions/
    ├── src/
    │   ├── app.ts                 # Express app, authentication, Zod validation
    │   ├── functions/             # Directory for all function implementations
    │   │   ├── own_profile/       # Functions related to current user's profile
    │   │   ├── user_profile/      # Functions related to other users' profiles
    │   │   ├── groups/           # Group-related functions
    │   │   └── ...
    │   ├── models/               # Data models and constants
    │   │   ├── constants.ts      # Enum constants
    │   │   ├── data-models.ts    # Response interfaces
    │   │   ├── validation-schemas.ts # Zod validation schemas
    │   │   └── ...
    │   ├── middleware/           # Express middleware
    │   │   ├── validation.ts     # Request validation middleware
    │   │   └── ...
    │   ├── utils/               # Utility functions
    │   │   ├── logging-utils.ts  # Logging utilities
    │   │   ├── timestamp_utils.ts # Timestamp formatting
    │   │   └── ...
    │   └── index.ts             # Firebase Function entry point
    ├── package.json
    └── tsconfig.json
    ```

- **Module Naming Conventions**
  - Use kebab-case for all file and directory names
  - Function implementation files should be named after the function they implement
  - Group related functions in subdirectories (e.g., `own_profile/`, `user_profile/`)

- **Firebase Admin Initialization**  
  - Call `initializeApp()` **only once** (in `app.ts`).  
  - Avoid re-initializing the Admin SDK for each request.
  - Example:
    ```typescript
    // In app.ts
    import { initializeApp } from "firebase-admin/app";
    
    // Initialize once at the module level
    initializeApp();
    ```

---

## 2. HTTP Routing (Express)

- **Single Entrypoint**  
  - Expose exactly one function (e.g., `api`) to Firebase:
    ```typescript
    // In index.ts
    import { onRequest } from "firebase-functions/v2/https";
    import { app } from "./app";

    export const api = onRequest(app);
    ```

- **Routes**  
  - Define clear endpoints in `app.ts`:
    ```typescript
    import express from "express";
    import { getProfile } from "./own_profile/get-my-profile";

    const app = express();

    app.get("/me/profile", handle_errors(false), async (req, res) => {
        await getProfile(req, res);
    });
    ```

- **Route Naming Conventions**
  - Use RESTful naming conventions:
    - `/me/profile` - Current user's profile
    - `/me/updates` - Current user's updates
    - `/me/friends` - Current user's friends
    - `/user/:target_user_id/profile` - Other user's profile
    - `/user/:target_user_id/updates` - Other user's updates

- **HTTP Methods**
  - Use appropriate HTTP methods:
    - `GET` for retrieving data
    - `POST` for creating new resources
    - `PUT` for updating existing resources
    - `DELETE` for removing resources

---

## 3. Authentication

- **ID Token Required**  
  - All endpoints (except explicitly public ones) **must** verify the Firebase ID token from `Authorization: Bearer <token>`.

- **Attach `userId`**  
  - In `app.ts`, use Express middleware to:
    1. Extract and verify the token with `auth.verifyIdToken`
    2. Attach `req.userId` or return 401 on error
    ```typescript
    // Authentication middleware
    const authenticate_request: RequestHandler = async (req, res, next) => {
        try {
            const auth_header = req.headers.authorization;
            if (!auth_header) {
                res.status(401).json({
                    code: 401,
                    name: "Unauthorized",
                    description: "Authentication required: valid Firebase ID token needed"
                });
                return;
            }

            const token = auth_header.startsWith("Bearer ")
                ? auth_header.split("Bearer ")[1]
                : auth_header;

            const decoded_token = await auth.verifyIdToken(token);
            const user_id = decoded_token.uid;

            if (!user_id) {
                res.status(401).json({
                    code: 401,
                    name: "Unauthorized",
                    description: "Invalid token: no user ID found"
                });
                return;
            }

            // Attach userId to request
            req.userId = user_id;
            next();
        } catch (error: unknown) {
            const error_message = error instanceof Error ? error.message : "Unknown error";
            res.status(401).json({
                code: 401,
                name: "Unauthorized",
                description: `Authentication failed: ${error_message}`
            });
        }
    };
    ```

- **Error Handling Middleware**
  - Use middleware for consistent error handling across routes:
    ```typescript
    const handle_errors = (validate_request: boolean = false): RequestHandler => {
        return (req, res, next) => {
            try {
                next();
            } catch (error: unknown) {
                if (error instanceof ZodError) {
                    if (validate_request) {
                        res.status(400).json({
                            code: 400,
                            name: "Bad Request",
                            description: "Invalid request parameters"
                        });
                        return;
                    }
                    throw error;
                }

                const error_message = error instanceof Error ? error.message : "Unknown error";
                console.error(`Error in ${req.path}: ${error_message}`);

                if (error && typeof error === 'object' && 'status' in error && typeof (error as any).status === 'number') {
                    res.status((error as any).status).json({
                        code: (error as any).status,
                        name: (error as any).name || "Error",
                        description: error_message
                    });
                    return;
                }

                res.status(500).json({
                    code: 500,
                    name: "Internal Server Error",
                    description: "An unexpected error occurred"
                });
            }
        };
    };
    ```

---

## 4. Firestore Usage

- **Direct Enum Access**
  - Always use direct enum access from the constants module:
    ```typescript
    import { Collections, ProfileFields } from "../models/constants";
    
    // Good
    db.collection(Collections.PROFILES).doc(userId);
    
    // Bad
    db.collection('profiles').doc(userId);
    ```

- **Constants Definition**
  - Define all collection names, field names, and status values as enums in `models/constants.ts`:
    ```typescript
    export enum Collections {
        PROFILES = "profiles",
        FRIENDS = "friends",
        UPDATES = "updates",
        GROUPS = "groups",
        SUMMARIES = "summaries",
        USER_SUMMARIES = "user_summaries",
        CHATS = "chats",
        SUMMARY = "summary"
    }

    export enum ProfileFields {
        NAME = "name",
        AVATAR = "avatar",
        GROUP_IDS = "group_ids"
    }

    export enum Status {
        PENDING = "pending",
        ACCEPTED = "accepted",
        REJECTED = "rejected"
    }
    ```

- **Document/Collection Pattern**
  - Use the document/collection pattern for Firestore references:
    ```typescript
    // Good
    const user_profile_ref = db.collection(Collections.PROFILES).doc(userId);
    const friends_ref = user_profile_ref.collection(Collections.FRIENDS);
    
    // Bad
    db.collection(`${Collections.PROFILES}/${userId}/${Collections.FRIENDS}`);
    ```

- **Basic Reads**  
  ```typescript
  import { getFirestore } from "firebase-admin/firestore";
  import { Collections, ProfileFields } from "../models/constants";
  import { getLogger } from "../utils/logging-utils";

  const logger = getLogger(__filename);
  const db = getFirestore();
  
  // Get document reference
  const doc_ref = db.collection(Collections.PROFILES).doc(userId);
  
  // Get document snapshot
  const doc_snapshot = await doc_ref.get();

  // Check if document exists
  if (!doc_snapshot.exists) {
      logger.warn(`Profile not found for user ${userId}`);
      return res.status(404).json({
          code: 404,
          name: "Not Found",
          description: "Profile not found"
      });
  }

  // Convert to dictionary with empty fallback
  const profile_data = doc_snapshot.data() || {};
  ```

- **Queries**
  - For filtering and limiting:
    ```typescript
    // Build query with filters, ordering, and limits
    const query = db.collection(Collections.UPDATES)
        .where(UpdateFields.CREATED_BY, QueryOperators.EQUALS, userId)
        .orderBy(UpdateFields.CREATED_AT, "desc")
        .limit(limit);
    
    // Execute query and iterate through results
    const results = await query.get();
    for (const doc of results.docs) {
        const doc_id = doc.id;
        const doc_data = doc.data();
        // Process document data
    }
    ```

- **Pagination**
  - For paginated queries, use the `startAfter` method:
    ```typescript
    // Apply pagination if an after_cursor is provided
    if (after_cursor) {
        query = query.startAfter({ [UpdateFields.CREATED_AT]: after_cursor });
    }
    
    // Track the last timestamp for next page
    let last_timestamp: string | null = null;
    
    // Process results and track last timestamp for pagination
    for (const doc of query.get().docs) {
        const doc_data = doc.data();
        const timestamp = doc_data[UpdateFields.CREATED_AT];
        if (timestamp) {
            last_timestamp = timestamp;
        }
    }
    
    // Set up pagination for the next request
    const next_cursor = last_timestamp && results.docs.length === limit
        ? last_timestamp
        : null;
    ```

---

## 5. Timestamp Formatting

- **Timestamp Types**
  - Use Firestore's `Timestamp` type for all timestamp fields:
    ```typescript
    import { Timestamp } from "firebase-admin/firestore";

    // For current time
    const now = Timestamp.now();

    // For specific timestamps
    const timestamp = new Timestamp(seconds, nanoseconds);
    ```

- **Timestamp Utility**
  - Use the timestamp formatting utility in `utils/timestamp-utils.ts` for consistent timestamp formatting:
    ```typescript
    import { formatInTimeZone } from "date-fns-tz";
    import { Timestamp } from "firebase-admin/firestore";

    /**
     * Formats a Firestore Timestamp to an ISO string in the same format as Python's datetime.isoformat()
     * This ensures consistent timestamp formatting between Python and TypeScript implementations.
     * 
     * @param timestamp - The Firestore Timestamp to format
     * @returns A string in the format "YYYY-MM-DDTHH:mm:ss.ssssss+00:00"
     */
    export const formatTimestamp = (timestamp: Timestamp): string => {
        const date = timestamp.toDate();
        return formatInTimeZone(date, "UTC", "yyyy-MM-dd'T'HH:mm:ss.SSSSSSxxx");
    };
    ```

- **Usage in Functions**
  - Always use `formatTimestamp` when returning timestamps in responses:
    ```typescript
    import { formatTimestamp } from "../utils/timestamp-utils";

    // When creating a response object
    const response = {
        id: doc.id,
        created_at: formatTimestamp(doc_data[UpdateFields.CREATED_AT]),
        updated_at: formatTimestamp(doc_data[UpdateFields.UPDATED_AT])
    };
    ```

- **Pagination Timestamps**
  - Use `formatTimestamp` for pagination tokens:
    ```typescript
    // When setting up pagination
    const next_cursor = last_timestamp && updates.length === limit
        ? formatTimestamp(last_timestamp)
        : null;
    ```

---

## 6. Zod Validation

- **Schema Definition**
  - Define Zod schemas in `models/validation-schemas.ts`:
    ```typescript
    import { z } from "zod";
    
    export const paginationSchema = z.object({
        limit: z.number().min(1).max(100).default(20),
        after_cursor: z.string().optional()
    });
    
    export const addFriendSchema = z.object({
        friend_id: z.string().min(1)
    });
    ```

- **Request Body Validation**
  - For validating incoming request data (e.g., POST, PUT):
    ```typescript
    import { validateRequest } from "../middleware/validation";
    import { addFriendSchema } from "../models/validation-schemas";

    app.post("/me/friends", handle_errors(true), validateRequest(addFriendSchema), async (req, res) => {
        await addFriend(req, res);
    });
    ```

- **Query Parameter Validation**
  - For GET requests with query parameters:
    ```typescript
    app.get("/me/updates", handle_errors(true), validateRequest(paginationSchema), async (req, res) => {
        await getUpdates(req, res);
    });
    ```

---

## 7. Using Interfaces for Output

  - **Interface Definition**
    - Define response interfaces in `models/data-models.ts`:
      ```typescript
      export interface Friend {
          id: string;
          name: string;
          avatar: string;
      }
      
      export interface FriendsResponse {
          friends: Friend[];
      }
      ```
  
  - **Creating Response Objects**
    - Create response objects from Firestore data:
      ```typescript
      // Create a Friend object from Firestore data
      const friend: Friend = {
          id: friend_user_id,
          name: profile_data[ProfileFields.NAME] ?? "",
          avatar: profile_data[ProfileFields.AVATAR] ?? ""
      };
      
      // Create a FriendsResponse with a list of friends
      const response: FriendsResponse = {
          friends: friends_list
      };
      
      // Return JSON response
      return res.json(response);
      ```

---

## 8. Error Handling

  - **HTTP Status Codes**
    - 401 Unauthorized for missing/invalid token
    - 403 Forbidden for restricted endpoints (or root path)
    - 404 Not Found if a requested document doesn't exist
    - 400 Bad Request for invalid input (Zod errors)
    - 500 Internal Server Error for unexpected exceptions
    - 200 OK for successful calls
  
  - **Exception Handling**
    - Wrap function implementations in try-catch blocks:
      ```typescript
      try {
          // Function implementation
          return res.json(response);
      } catch (error: unknown) {
          logger.error(`Error in function: ${error instanceof Error ? error.message : "Unknown error"}`, { error });
          return res.status(500).json({
              code: 500,
              name: "Internal Server Error",
              description: "An unexpected error occurred"
          });
      }
      ```
  
  - **Error Handling Approach**
    - For all functions, use appropriate status codes for error conditions:
      ```typescript
      if (!doc_snapshot.exists) {
          logger.warn(`Profile not found for user ${userId}`);
          return res.status(404).json({
              code: 404,
              name: "Not Found",
              description: "Profile not found"
          });
      }
      ```
    
    - Do not return empty responses on errors - always use appropriate status codes
    - Include descriptive error messages:
      ```typescript
      return res.status(404).json({
          code: 404,
          name: "Not Found",
          description: "Profile not found"
      });
      return res.status(400).json({
          code: 400,
          name: "Bad Request",
          description: `Profile already exists for user ${req.userId}`
      });
      return res.status(500).json({
          code: 500,
          name: "Internal Server Error",
          description: "An unexpected error occurred"
      });
      ```

  - **Partial Data**
    - Always allow partial responses if some fields in Firestore are missing
    - Replace missing fields with empty defaults and do not fail the request entirely
    - Use nullish coalescing for default values:
      ```typescript
      const name = profile_data[ProfileFields.NAME] ?? "";
      const avatar = profile_data[ProfileFields.AVATAR] ?? "";
      const group_ids = profile_data[ProfileFields.GROUP_IDS] ?? [];
      ```

---

## 9. Logging

  - **Logging Utility**
    - Create a logging utility in `utils/logging-utils.ts`:
      ```typescript
      /**
       * Creates and returns a logger with the specified name.
       * 
       * This utility function provides a standardized way to create loggers
       * across the application, ensuring consistent formatting and behavior.
       * 
       * @param name - The name for the logger, typically __filename from the calling module
       * @returns A configured logger instance with consistent formatting
       */
      export const getLogger = (name: string) => {
          // Format the name to be more readable (remove file extension and path)
          const formattedName = name.split('/').pop()?.replace('.ts', '') || name;

          return {
              info: (message: string, ...args: any[]) => {
                  const timestamp = new Date().toISOString();
                  console.log(`[${timestamp}] [${formattedName}] [INFO] ${message}`, ...args);
              },
              warn: (message: string, ...args: any[]) => {
                  const timestamp = new Date().toISOString();
                  console.warn(`[${timestamp}] [${formattedName}] [WARN] ${message}`, ...args);
              },
              error: (message: string, ...args: any[]) => {
                  const timestamp = new Date().toISOString();
                  console.error(`[${timestamp}] [${formattedName}] [ERROR] ${message}`, ...args);
              },
              debug: (message: string, ...args: any[]) => {
                  const timestamp = new Date().toISOString();
                  console.debug(`[${timestamp}] [${formattedName}] [DEBUG] ${message}`, ...args);
              }
          };
      };
      ```
  
  - **Standardized Logging**
    - Use the logging utility for consistent logging across files:
      ```typescript
      import { getLogger } from "../utils/logging-utils";
      
      const logger = getLogger(__filename);
      
      export const myFunction = async (req: Request, res: Response) => {
          logger.info(`Starting function execution for user: ${req.userId}`);
          
          // Function implementation
          
          logger.info(`Function completed successfully for user: ${req.userId}`);
          return res.json(response);
      };
      ```
    
  - **Log Levels**
    - `info`: Normal operation information (function start/end, successful operations)
      ```typescript
      logger.info(`Retrieving profile for user: ${req.userId}`);
      logger.info(`Retrieved ${updates.length} updates for user: ${req.userId}`);
      ```
    - `warn`: Potential issues that don't cause function failure (missing data, skipped operations)
      ```typescript
      logger.warn(`Profile not found for user: ${userId}`);
      logger.warn(`Friend ${friendUserId} profile not found, skipping`);
      ```
    - `error`: Errors that cause function failure (exceptions, critical missing data)
      ```typescript
      logger.error(`Error retrieving profile for user ${userId}: ${error instanceof Error ? error.message : "Unknown error"}`);
      ```
    - `debug`: Detailed information for debugging purposes
      ```typescript
      logger.debug(`Processing request with parameters: ${JSON.stringify(req.query)}`);
      ```
    
  - **Contextual Information**
    - Include relevant context in log messages:
      ```typescript
      logger.info(`Processing request for user: ${req.userId}`);
      logger.warn(`Profile not found for user: ${userId}`);
      logger.error(`Error retrieving data: ${error instanceof Error ? error.message : "Unknown error"}`);
      ```
    - Always include user IDs in log messages for easier troubleshooting
    - For pagination, include pagination parameters:
      ```typescript
      logger.info(`Pagination parameters - limit: ${limit}, after_cursor: ${after_cursor}`);
      ```
    - Include operation outcomes:
      ```typescript
      logger.info(`Successfully created profile for user ${req.userId}`);
      logger.info(`Successfully added friend ${friendId} for user ${req.userId}`);
      ```

---

## 10. Function Implementation

  - **Function Documentation**
    - Include detailed JSDoc comments for all functions:
      ```typescript
      /**
       * Retrieves the current user's profile.
       * 
       * This function fetches the profile of the authenticated user from Firestore.
       * If the profile does not exist, a 404 error is returned.
       * 
       * @param req - The Express request object containing:
       *              - userId: The authenticated user's ID (attached by authentication middleware)
       * @param res - The Express response object
       * 
       * @returns A ProfileResponse containing:
       * - Basic profile information (id, name, avatar)
       * - List of group IDs the user is a member of
       * 
       * @throws 404: If the user profile does not exist
       * @throws 500: If an unexpected error occurs during profile retrieval
       */
      export const getProfile = async (req: Request, res: Response) => {
          // Implementation
      };
      ```
  
  - **Function Structure**
    - Follow a consistent structure for all functions:
      1. Initialize logger
      2. Log function start with user ID
      3. Get Firestore client
      4. Extract parameters from request
      5. Implement function logic in try-catch block
      6. Log function completion with user ID
      7. Return response
      ```typescript
      export const myFunction = async (req: Request, res: Response) => {
          // 1. Initialize logger
          const logger = getLogger(__filename);
          
          // 2. Log function start
          logger.info(`Starting function for user: ${req.userId}`);
          
          // 3. Get Firestore client
          const db = getFirestore();
          
          // 4. Extract parameters
          const param1 = req.validated_params?.param1;
          
          try {
              // 5. Implement function logic
              // ...
              
              // 6. Log function completion
              logger.info(`Function completed successfully for user: ${req.userId}`);
              
              // 7. Return response
              return res.json(response);
          } catch (error: unknown) {
              logger.error(`Error in function for user ${req.userId}: ${error instanceof Error ? error.message : "Unknown error"}`);
              return res.status(500).json({
                  code: 500,
                  name: "Internal Server Error",
                  description: "An unexpected error occurred"
              });
          }
      };
      ```
    
  - **Pagination Implementation**
    - For paginated endpoints, use consistent pagination parameters and logic:
      ```typescript
      // Get pagination parameters from the validated request
      const validated_params = req.validated_params;
      const limit = validated_params?.limit ?? 20;
      const after_cursor = validated_params?.after_cursor;
      
      // Log pagination parameters
      logger.info(`Pagination parameters - limit: ${limit}, after_cursor: ${after_cursor}`);
      
      // Build base query
      const query = db.collection(Collections.UPDATES)
          .where(UpdateFields.CREATED_BY, QueryOperators.EQUALS, userId)
          .orderBy(UpdateFields.CREATED_AT, "desc")
          .limit(limit);
      
      // Apply pagination if an after_cursor is provided
      if (after_cursor) {
          query = query.startAfter({ [UpdateFields.CREATED_AT]: after_cursor });
      }
      
      // Execute query and process results
      const updates: Update[] = [];
      let last_timestamp: string | null = null;
      
      for (const doc of (await query.get()).docs) {
          const doc_data = doc.data();
          const created_at = doc_data[UpdateFields.CREATED_AT];
          
          if (created_at) {
              last_timestamp = created_at;
          }
          
          // Add to results
          updates.push(Update.fromFirestore(doc_data));
      }
      
      // Set up pagination for the next request
      const next_cursor = last_timestamp && updates.length === limit
          ? last_timestamp
          : null;
      
      logger.info(`Retrieved ${updates.length} updates for user: ${req.userId}`);
      
      // Return response with pagination token
      return res.json({
          updates,
          next_cursor
      });
      ```

  - **Friend Relationship Handling**
    - For functions that deal with friend relationships:
      ```typescript
      // Check if users are friends
      const friend_ref = user_profile_ref.collection(Collections.FRIENDS).doc(friendId);
      const is_friend = (await friend_ref.get()).exists;
      
      // If they are not friends, return an error
      if (!is_friend) {
          logger.warn(`User ${req.userId} attempted to view profile of non-friend ${friendId}`);
          return res.status(403).json({
              code: 403,
              name: "Forbidden",
              description: "You must be friends with this user to view their profile"
          });
      }
      ```

---

## 11. Code Style and Formatting

  - **Imports**
    - Group imports in the following order:
      1. Standard library imports
      2. Third-party imports (Express, Firebase, etc.)
      3. Local imports (models, utils, etc.)
    - Example:
      ```typescript
      // Standard library imports
      import { Request, Response } from "express";
      
      // Third-party imports
      import { getFirestore } from "firebase-admin/firestore";
      
      // Local imports
      import { Collections, ProfileFields } from "../models/constants";
      import { ProfileResponse } from "../models/data-models";
      import { getLogger } from "../utils/logging-utils";
      ```
  
  - **Whitespace**
    - Use consistent whitespace:
      - No trailing whitespace at the end of lines
      - Consistent indentation (4 spaces)
      - Single blank line between logical sections of code
      - No excessive blank lines (maximum 2 consecutive blank lines)
  
  - **Line Length**
    - Keep lines under 100 characters when possible
    - For long lines, use line breaks at logical points:
      ```typescript
      // Good
      const query = db.collection(Collections.UPDATES)
          .where(UpdateFields.CREATED_BY, QueryOperators.EQUALS, userId)
          .orderBy(UpdateFields.CREATED_AT, "desc")
          .limit(limit);
      
      // Also good
      if (SummaryFields.EMOTIONAL_JOURNEY in summary_data && 
              summary_data[SummaryFields.EMOTIONAL_JOURNEY]) {
          emotional_journey_parts.push(summary_data[SummaryFields.EMOTIONAL_JOURNEY]);
      }
      ```

  - **Variable Naming**
    - Use descriptive variable names:
      - `userId` instead of `uid`
      - `profileData` instead of `data`
      - `friendRef` instead of `ref`
    - Use camelCase for variable and function names
    - Use PascalCase for interfaces and types

---

## 12. Testing and Deployment

  - **Local Testing**
    - Test functions locally before deployment:
      ```typescript
      // In app.ts
      if (process.env.NODE_ENV === "development") {
          app.listen(3000, () => {
              console.log("Server running on port 3000");
          });
      }
      ```
  
  - **Deployment**
    - Deploy using Firebase CLI:
      ```
      firebase deploy --only functions
      ```
    - Never deploy untested code
    - Always review changes before deployment

  - **Environment Variables**
    - Use environment variables for configuration:
      ```typescript
      const DEBUG = process.env.DEBUG === "true";
      ```
    - Set environment variables in Firebase:
      ```
      firebase functions:config:set debug=true
      ```