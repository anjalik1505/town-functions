from firebase_admin import firestore
from flask import abort
from models.constants import Collections, ProfileFields, UpdateFields, FriendFields, Status
from models.data_models import UpdatesResponse, Update
from utils.logging_utils import get_logger


def get_user_updates(request, user_id) -> UpdatesResponse:
    """
    Retrieves paginated updates for a specific user.
    
    This function fetches updates created by the specified user, ordered by creation time
    (newest first) and supports pagination for efficient data loading. The function enforces
    friendship checks to ensure only friends can view each other's updates.
    
    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
                - validated_params: Pagination parameters containing:
                    - limit: Maximum number of updates to return
                    - after_timestamp: Timestamp for pagination
        user_id: The ID of the user whose updates are being requested
    
    Query Parameters:
        - limit: Maximum number of updates to return (default: 20, min: 1, max: 100)
        - after_timestamp: Timestamp for pagination in ISO format (e.g. "2025-01-01T12:00:00Z")
    
    Returns:
        An UpdatesResponse containing:
        - A list of updates created by the specified user
        - A next_timestamp for pagination (if more results are available)
    
    Raises:
        400: If the user tries to view their own updates through this endpoint.
        404: If the target user profile does not exist.
        403: If the requesting user and target user are not friends.
    """
    logger = get_logger(__name__)
    logger.info(f"Retrieving updates for user {user_id} requested by {request.user_id}")

    db = firestore.client()
    current_user_id = request.user_id

    # Redirect users to the appropriate endpoint for their own updates
    if current_user_id == user_id:
        logger.warning(f"User {current_user_id} attempted to view their own updates through /user endpoint")
        abort(400, "Use /me/updates endpoint to view your own updates")

    try:
        # Get pagination parameters from the validated request
        validated_params = request.validated_params
        limit = validated_params.limit
        after_timestamp = validated_params.after_timestamp

        logger.info(f"Pagination parameters - limit: {limit}, after_timestamp: {after_timestamp}")

        # Get the target user's profile
        target_user_profile_ref = db.collection(Collections.PROFILES).document(user_id)
        target_user_profile_doc = target_user_profile_ref.get()

        # Check if the target profile exists
        if not target_user_profile_doc.exists:
            logger.warning(f"Profile not found for user {user_id}")
            abort(404, "Profile not found")

        # Check if users are friends
        current_user_profile_ref = db.collection(Collections.PROFILES).document(current_user_id)
        friend_ref = current_user_profile_ref.collection(Collections.FRIENDS).document(user_id)
        friend_doc = friend_ref.get()

        # If they are not friends, return an error
        if not friend_doc.exists or friend_doc.to_dict().get(FriendFields.STATUS) != Status.ACCEPTED:
            logger.warning(f"User {current_user_id} attempted to view updates of non-friend {user_id}")
            abort(403, "You must be friends with this user to view their updates")

        logger.info(f"Friendship verified between {current_user_id} and {user_id}")

        # Build the query for updates created by the target user
        query = db.collection(Collections.UPDATES) \
            .where(UpdateFields.CREATED_BY, "==", user_id) \
            .order_by(UpdateFields.CREATED_AT, direction=firestore.Query.DESCENDING) \
            .limit(limit)

        # Apply pagination if an after_timestamp is provided
        if after_timestamp:
            query = query.start_after({UpdateFields.CREATED_AT: after_timestamp})
            logger.info(f"Applying pagination with timestamp: {after_timestamp}")

        # Execute the query
        docs = query.stream()
        logger.info("Query executed successfully")

        updates = []
        last_timestamp = None

        # Process the query results
        for doc in docs:
            doc_data = doc.to_dict()
            created_at = doc_data.get(UpdateFields.CREATED_AT, "")

            # Track the last timestamp for pagination
            if created_at:
                last_timestamp = created_at

            # Convert Firestore document to Update model
            updates.append(Update(
                updateId=doc.id,
                created_by=doc_data.get(UpdateFields.CREATED_BY, ""),
                content=doc_data.get(UpdateFields.CONTENT, ""),
                group_ids=doc_data.get(UpdateFields.GROUP_IDS, []),
                sentiment=doc_data.get(UpdateFields.SENTIMENT, 0),
                created_at=created_at
            ))

        # Set up pagination for the next request
        next_timestamp = None
        if last_timestamp and len(updates) == limit:
            next_timestamp = last_timestamp
            logger.info(f"More results available, next_timestamp: {next_timestamp}")

        logger.info(f"Retrieved {len(updates)} updates for user: {user_id}")
        return UpdatesResponse(
            updates=updates,
            next_timestamp=next_timestamp
        )
    except Exception as e:
        logger.error(f"Error retrieving updates for user {user_id}: {str(e)}", exc_info=True)
        abort(500, "Internal server error while retrieving user updates")
