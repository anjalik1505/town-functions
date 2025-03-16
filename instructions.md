# Refined Instructions: Firebase Functions in Python (Flask)

> **Note:**  
> These instructions are **strict** requirements.  
> **Do not** deploy code automatically. Any code generated should be manually verified before deployment.

---

## 1. Project Structure

- **Standardized Organization**  
  - Follow this project structure:
    ```
    .
    ├── main.py                # Flask app, authentication, Pydantic validation
    ├── functions/             # Directory for all function implementations
    │   ├── own_profile/       # Functions related to current user's profile
    │   │   ├── get_my_profile.py
    │   │   ├── get_my_updates.py
    │   │   ├── get_my_friends.py
    │   │   ├── get_my_feeds.py
    │   │   ├── add_user.py
    │   │   ├── add_friend.py
    │   │   └── ...
    │   ├── user_profile/      # Functions related to other users' profiles
    │   │   ├── get_user_profile.py
    │   │   ├── get_user_updates.py
    │   │   └── ...
    │   └── ...
    ├── models/                # Data models and constants
    │   ├── constants.py       # Enum constants
    │   ├── data_models.py     # Response dataclasses
    │   ├── pydantic_models.py # Request validation models
    │   └── ...
    ├── utils/                 # Utility functions
    │   ├── logging_utils.py   # Logging utilities
    │   └── ...
    └── requirements.txt
    ```

- **Module Naming Conventions**
  - Use snake_case for all file and directory names
  - Function implementation files should be named after the function they implement
  - Group related functions in subdirectories (e.g., `own_profile/`, `user_profile/`)

- **Firebase Admin Initialization**  
  - Call `firebase_admin.initialize_app()` **only once** (in `main.py`).  
  - Avoid re-initializing the Admin SDK for each request.
  - Example:
    ```python
    # In main.py
    from firebase_admin import initialize_app
    
    # Initialize once at the module level
    initialize_app()
    ```

---

## 2. HTTP Routing (Flask)

- **Single Entrypoint**  
  - Expose exactly one function (e.g., `api`) to Firebase:
    ```python
    @https_fn.on_request()
    def api(incoming_request):
        """Cloud Function entry point that dispatches incoming HTTP requests to the Flask app."""
        with app.request_context(incoming_request.environ):
            return app.full_dispatch_request()
    ```

- **Routes**  
  - Define clear endpoints in `main.py`:
    ```python
    from flask import Flask, abort, request
    from own_profile.get_my_profile import get_my_profile

    app = Flask(__name__)

    @app.route('/', methods=['GET'])
    def index():
        abort(403, description="Forbidden")

    @app.route('/me/profile', methods=['GET'])
    def my_profile():
        return get_my_profile(request).to_json()
    ```

- **Route Naming Conventions**
  - Use RESTful naming conventions:
    - `/me/profile` - Current user's profile
    - `/me/updates` - Current user's updates
    - `/me/friends` - Current user's friends
    - `/user/<user_id>/profile` - Other user's profile
    - `/user/<user_id>/updates` - Other user's updates

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

- **Attach `user_id`**  
  - In `main.py`, use a `@app.before_request` hook to:
    1. Extract and verify the token with `firebase_admin.auth.verify_id_token`.
    2. Attach `request.user_id` or `abort(401)` on error.
    ```python
    @app.before_request
    def authenticate():
        # Skip authentication for public routes
        if request.path in PUBLIC_ROUTES:
            return
            
        # Get the Authorization header
        auth_header = request.headers.get('Authorization', '')
        if not auth_header.startswith('Bearer '):
            abort(401, description="Missing or invalid Authorization header")
            
        # Extract and verify the token
        token = auth_header.split('Bearer ')[1]
        try:
            decoded_token = auth.verify_id_token(token)
            request.user_id = decoded_token['uid']
        except Exception as e:
            abort(401, description=f"Invalid token: {str(e)}")
    ```

- **Error Decorator**
  - Use a decorator for consistent error handling across routes:
    ```python
    def handle_errors(validate_request=False):
        """
        A decorator for route handlers that provides consistent error handling.
        
        Args:
            validate_request: If True, ValidationError will be caught and return 400.
                            If False, ValidationError will be propagated.
        """
        def decorator(f):
            @functools.wraps(f)
            def wrapper(*args, **kwargs):
                try:
                    return f(*args, **kwargs)
                except ValidationError as e:
                    if validate_request:
                        abort(400, description=str(e))
                    raise
                except HTTPException:
                    raise
                except Exception:
                    abort(500, description="Internal server error")
            return wrapper
        return decorator
    ```

---

## 4. Firestore Usage

- **Direct Enum Access**
  - Always use direct enum access from the constants module:
    ```python
    from models.constants import Collections, ProfileFields
    
    # Good
    db.collection(Collections.PROFILES).document(user_id)
    
    # Bad
    db.collection('profiles').document(user_id)
    ```

- **Constants Definition**
  - Define all collection names, field names, and status values as enums in `models/constants.py`:
    ```python
    class Collections:
        PROFILES = "profiles"
        FRIENDS = "friends"
        UPDATES = "updates"
        GROUPS = "groups"
        SUMMARIES = "summaries"
        USER_SUMMARIES = "user_summaries"
        CHATS = "chats"
        SUMMARY = "summary"

    class ProfileFields:
        NAME = "name"
        AVATAR = "avatar"
        GROUP_IDS = "group_ids"
        
    class Status:
        PENDING = "pending"
        ACCEPTED = "accepted"
        REJECTED = "rejected"
    ```

- **Document/Collection Pattern**
  - Use the document/collection pattern for Firestore references:
    ```python
    # Good
    user_profile_ref = db.collection(Collections.PROFILES).document(user_id)
    friends_ref = user_profile_ref.collection(Collections.FRIENDS)
    
    # Bad
    db.collection(f"{Collections.PROFILES}/{user_id}/{Collections.FRIENDS}")
    ```

- **Basic Reads**  
  ```python
  from firebase_admin import firestore
  from flask import abort
  from models.constants import Collections, ProfileFields
  from utils.logging_utils import get_logger

  logger = get_logger(__name__)
  db = firestore.client()
  
  # Get document reference
  doc_ref = db.collection(Collections.PROFILES).document(user_id)
  
  # Get document snapshot
  doc_snapshot = doc_ref.get()

  # Check if document exists
  if not doc_snapshot.exists:
      logger.warning(f"Profile not found for user {user_id}")
      abort(404, "Profile not found")

  # Convert to dictionary with empty fallback
  profile_data = doc_snapshot.to_dict() or {}
  ```

- **Queries**
  - For filtering and limiting:
    ```python
    # Build query with filters, ordering, and limits
    query = db.collection(Collections.UPDATES) \
        .where(UpdateFields.CREATED_BY, QueryOperators.EQUALS, user_id) \
        .order_by(UpdateFields.CREATED_AT, direction=firestore.Query.DESCENDING) \
        .limit(limit)
    
    # Execute query and iterate through results
    results = query.stream()
    for doc in results:
        doc_id = doc.id
        doc_data = doc.to_dict()
        # Process document data
    ```

- **Pagination**
  - For paginated queries, use the `start_after` method:
    ```python
    # Apply pagination if an after_timestamp is provided
    if after_timestamp:
        query = query.start_after({UpdateFields.CREATED_AT: after_timestamp})
    
    # Track the last timestamp for next page
    last_timestamp = None
    
    # Process results and track last timestamp for pagination
    for doc in query.stream():
        doc_data = doc.to_dict()
        timestamp = doc_data.get(UpdateFields.CREATED_AT)
        if timestamp:
            last_timestamp = timestamp
    
    # Set up pagination for the next request
    next_timestamp = None
    if last_timestamp and len(results) == limit:
        next_timestamp = last_timestamp
    ```

---

## 5. Pydantic Validation (in main.py)

- **Model Definition**
  - Define Pydantic models in `models/pydantic_models.py`:
    ```python
    from pydantic import BaseModel, Field
    
    class GetPaginatedRequest(BaseModel):
        limit: int = Field(default=20, ge=1, le=100)
        after_timestamp: str | None = None
    
    class AddFriendRequest(BaseModel):
        friend_id: str
    ```

- **Request Body Validation**
  - For validating incoming request data (e.g., POST, PUT):
    ```python
    from pydantic import BaseModel, ValidationError
    from flask import request, abort
    from models.pydantic_models import AddFriendRequest

    @app.route('/me/friends', methods=['POST'])
    def add_my_friend():
        try:
            # Validate request body
            payload = AddFriendRequest.model_validate(request.get_json())
            # Pass validated data to function
            return add_friend(request, payload.friend_id).to_json()
        except ValidationError as e:
            abort(400, description=str(e))
    ```

- **Query Parameter Validation**
  - For GET requests with query parameters:
    ```python
    @app.route('/me/updates', methods=['GET'])
    def my_updates():
        # Convert query parameters to dictionary
        params = request.args.to_dict(flat=True)
        # Validate parameters
        request.validated_params = GetPaginatedRequest.model_validate(params)
        # Pass request with validated parameters to function
        return get_my_updates(request).to_json()
    ```

---

## 6. Using Dataclasses for Output

  - **Dataclass Definition**
    - Define response models in `models/data_models.py`:
      ```python
      from dataclasses import dataclass, asdict
      from typing import List, Optional
      
      @dataclass
      class Friend:
          id: str
          name: str
          avatar: str
      
      @dataclass
      class FriendsResponse:
          friends: List[Friend]
          
          def to_json(self):
              return asdict(self)
      ```
  
  - **Creating Response Objects**
    - Create response objects from Firestore data:
      ```python
      # Create a Friend object from Firestore data
      friend = Friend(
          id=friend_user_id,
          name=profile_data.get(ProfileFields.NAME, ""),
          avatar=profile_data.get(ProfileFields.AVATAR, "")
      )
      
      # Create a FriendsResponse with a list of friends
      response = FriendsResponse(
          friends=friends_list
      )
      
      # Convert to JSON for HTTP response
      return response.to_json()
      ```

---

## 7. Error Handling

  - **HTTP Status Codes**
    - 401 Unauthorized for missing/invalid token
    - 403 Forbidden for restricted endpoints (or root path)
    - 404 Not Found if a requested document doesn't exist
    - 400 Bad Request for invalid input (Pydantic errors)
    - 500 Internal Server Error for unexpected exceptions
    - 200 OK for successful calls
  
  - **Exception Handling**
    - Wrap function implementations in try-except blocks:
      ```python
      try:
          # Function implementation
          return response
      except Exception as e:
          logger.error(f"Error in function: {str(e)}", exc_info=True)
          abort(500, "Internal server error")
      ```
  
  - **Error Handling Approach**
    - For all functions, use abort() with appropriate status codes for error conditions:
      ```python
      except Exception as e:
          logger.error(f"Error in function: {str(e)}", exc_info=True)
          abort(500, "Internal server error")
      ```
    
    - Do not return empty responses on errors - always use abort() with the appropriate status code.
    - Include descriptive error messages:
      ```python
      abort(404, "Profile not found")
      abort(400, f"Profile already exists for user {request.user_id}")
      abort(500, "Internal server error")
      ```

  - **Partial Data**
    - Always allow partial responses if some fields in Firestore are missing.
    - Replace missing fields with empty defaults and do not fail the request entirely.
    - Use `.get()` with default values to handle missing fields gracefully:
      ```python
      name = profile_data.get(ProfileFields.NAME, "")
      avatar = profile_data.get(ProfileFields.AVATAR, "")
      group_ids = profile_data.get(ProfileFields.GROUP_IDS, [])
      ```

---

## 8. Logging

  - **Logging Utility**
    - Create a logging utility in `utils/logging_utils.py`:
      ```python
      import logging
      
      def get_logger(name):
          """
          Get a logger with the specified name.
          
          Args:
              name: The name of the logger, typically __name__
              
          Returns:
              A configured logger instance
          """
          logger = logging.getLogger(name)
          return logger
      ```
  
  - **Standardized Logging**
    - Use the logging utility for consistent logging across files:
      ```python
      from utils.logging_utils import get_logger
      
      def my_function(request):
          logger = get_logger(__name__)
          logger.info(f"Starting function execution for user: {request.user_id}")
          
          # Function implementation
          
          logger.info(f"Function completed successfully for user: {request.user_id}")
          return response
      ```
    
  - **Log Levels**
    - `info`: Normal operation information (function start/end, successful operations)
      ```python
      logger.info(f"Retrieving profile for user: {request.user_id}")
      logger.info(f"Retrieved {len(updates)} updates for user: {request.user_id}")
      ```
    - `warning`: Potential issues that don't cause function failure (missing data, skipped operations)
      ```python
      logger.warning(f"Profile not found for user: {user_id}")
      logger.warning(f"Friend {friend_user_id} profile not found, skipping")
      ```
    - `error`: Errors that cause function failure (exceptions, critical missing data)
      ```python
      logger.error(f"Error retrieving profile for user {user_id}: {str(e)}", exc_info=True)
      ```
    
  - **Contextual Information**
    - Include relevant context in log messages:
      ```python
      logger.info(f"Processing request for user: {request.user_id}")
      logger.warning(f"Profile not found for user: {user_id}")
      logger.error(f"Error retrieving data: {str(e)}", exc_info=True)
      ```
    - Always include user IDs in log messages for easier troubleshooting
    - For pagination, include pagination parameters:
      ```python
      logger.info(f"Pagination parameters - limit: {limit}, after_timestamp: {after_timestamp}")
      ```
    - Include operation outcomes:
      ```python
      logger.info(f"Successfully created profile for user {request.user_id}")
      logger.info(f"Successfully added friend {friend_id} for user {request.user_id}")
      ```

---

## 9. Function Implementation

  - **Function Documentation**
    - Include detailed docstrings for all functions:
      ```python
      def get_my_profile(request) -> ProfileResponse:
          """
          Retrieves the current user's profile.
          
          This function fetches the profile of the authenticated user from Firestore.
          If the profile does not exist, a 404 error is returned.
          
          Args:
              request: The Flask request object containing:
                      - user_id: The authenticated user's ID (attached by authentication middleware)
          
          Returns:
              A ProfileResponse containing:
              - Basic profile information (id, name, avatar)
              - List of group IDs the user is a member of
          
          Raises:
              404: If the user profile does not exist.
              500: If an unexpected error occurs during profile retrieval.
          """
      ```
  
  - **Function Structure**
    - Follow a consistent structure for all functions:
      1. Initialize logger
      2. Log function start with user ID
      3. Get Firestore client
      4. Extract parameters from request
      5. Implement function logic in try-except block
      6. Log function completion with user ID
      7. Return response
      ```python
      def my_function(request) -> ResponseType:
          # 1. Initialize logger
          logger = get_logger(__name__)
          
          # 2. Log function start
          logger.info(f"Starting function for user: {request.user_id}")
          
          # 3. Get Firestore client
          db = firestore.client()
          
          # 4. Extract parameters
          param1 = request.validated_params.param1
          
          try:
              # 5. Implement function logic
              # ...
              
              # 6. Log function completion
              logger.info(f"Function completed successfully for user: {request.user_id}")
              
              # 7. Return response
              return ResponseType(...)
          except Exception as e:
              logger.error(f"Error in function for user {request.user_id}: {str(e)}", exc_info=True)
              abort(500, "Internal server error")
      ```
    
  - **Pagination Implementation**
    - For paginated endpoints, use consistent pagination parameters and logic:
      ```python
      # Get pagination parameters from the validated request
      validated_params = request.validated_params
      limit = validated_params.limit
      after_timestamp = validated_params.after_timestamp
      
      # Log pagination parameters
      logger.info(f"Pagination parameters - limit: {limit}, after_timestamp: {after_timestamp}")
      
      # Build base query
      query = db.collection(Collections.UPDATES) \
          .where(UpdateFields.CREATED_BY, QueryOperators.EQUALS, user_id) \
          .order_by(UpdateFields.CREATED_AT, direction=firestore.Query.DESCENDING) \
          .limit(limit)
      
      # Apply pagination if an after_timestamp is provided
      if after_timestamp:
          query = query.start_after({UpdateFields.CREATED_AT: after_timestamp})
      
      # Execute query and process results
      updates = []
      last_timestamp = None
      
      for doc in query.stream():
          doc_data = doc.to_dict()
          created_at = doc_data.get(UpdateFields.CREATED_AT)
          
          if created_at:
              last_timestamp = created_at
          
          # Add to results
          updates.append(Update(...))
      
      # Set up pagination for the next request
      next_timestamp = None
      if last_timestamp and len(updates) == limit:
          next_timestamp = last_timestamp
          logger.info(f"More results available, next_timestamp: {next_timestamp}")
      
      logger.info(f"Retrieved {len(updates)} updates for user: {request.user_id}")
      
      # Return response with pagination token
      return UpdatesResponse(
          updates=updates,
          next_timestamp=next_timestamp
      )
      ```

  - **Friend Relationship Handling**
    - For functions that deal with friend relationships:
      ```python
      # Check if users are friends
      friend_ref = user_profile_ref.collection(Collections.FRIENDS).document(friend_id)
      is_friend = friend_ref.get().exists
      
      # If they are not friends, return an error
      if not is_friend:
          logger.warning(f"User {request.user_id} attempted to view profile of non-friend {friend_id}")
          abort(403, "You must be friends with this user to view their profile")
      ```

---

## 10. Code Style and Formatting

  - **Imports**
    - Group imports in the following order:
      1. Standard library imports
      2. Third-party imports (Flask, Firebase, etc.)
      3. Local imports (models, utils, etc.)
    - Example:
      ```python
      # Standard library imports
      import datetime
      import functools
      
      # Third-party imports
      from firebase_admin import firestore
      from flask import abort, request
      
      # Local imports
      from models.constants import Collections, ProfileFields
      from models.data_models import ProfileResponse
      from utils.logging_utils import get_logger
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
      ```python
      # Good
      query = db.collection(Collections.UPDATES) \
          .where(UpdateFields.CREATED_BY, QueryOperators.EQUALS, user_id) \
          .order_by(UpdateFields.CREATED_AT, direction=firestore.Query.DESCENDING) \
          .limit(limit)
      
      # Also good
      if (SummaryFields.EMOTIONAL_JOURNEY in summary_data and 
              summary_data[SummaryFields.EMOTIONAL_JOURNEY]):
          emotional_journey_parts.append(summary_data[SummaryFields.EMOTIONAL_JOURNEY])
      ```

  - **Variable Naming**
    - Use descriptive variable names:
      - `user_id` instead of `uid`
      - `profile_data` instead of `data`
      - `friend_ref` instead of `ref`
    - Use snake_case for variable and function names
    - Use PascalCase for class names and dataclasses

---

## 11. Testing and Deployment

  - **Local Testing**
    - Test functions locally before deployment:
      ```python
      if __name__ == '__main__':
          app.run(debug=True)
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
      ```python
      import os
      
      DEBUG = os.environ.get('DEBUG', 'False').lower() == 'true'
      ```
    - Set environment variables in Firebase:
      ```
      firebase functions:config:set debug=true
      ```