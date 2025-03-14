from firebase_admin import firestore
from flask import abort
from models.constants import Collections, ProfileFields, UpdateFields
from models.data_models import FeedResponse, Update
from utils.logging_utils import get_logger


def get_my_feeds(request) -> FeedResponse:
    """
    Aggregates feed of all updates from all groups the current user is in, paginated.
    
    This function retrieves updates from all groups that the authenticated user is a member of.
    The updates are returned in descending order by creation time (newest first) and
    support pagination for efficient data loading. If the user is not a member of any groups
    or if their profile does not exist, an empty update list is returned.
    
    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
                - validated_params: Pagination parameters containing:
                    - limit: Maximum number of updates to return
                    - after_timestamp: Timestamp for pagination
    
    Query Parameters:
        - limit: Maximum number of updates to return (default: 20, min: 1, max: 100)
        - after_timestamp: Timestamp for pagination in ISO format (e.g. "2025-01-01T12:00:00Z")
    
    Returns:
        A FeedResponse containing:
        - A list of updates from all groups the user is in
        - A next_timestamp for pagination (if more results are available)
    """
    logger = get_logger(__name__)
    logger.info(f"Retrieving feed for user: {request.user_id}")

    # Get the authenticated user ID from the request
    current_user_id = request.user_id

    # Initialize Firestore client
    db = firestore.client()

    # Get pagination parameters from the validated request
    validated_params = request.validated_params
    limit = validated_params.limit if validated_params else 20
    after_timestamp = validated_params.after_timestamp if validated_params else None

    logger.info(f"Pagination parameters - limit: {limit}, after_timestamp: {after_timestamp}")

    try:
        # Get the user's profile
        user_ref = db.collection(Collections.PROFILES).document(current_user_id)
        user_doc = user_ref.get()

        # Return empty response if user profile doesn't exist
        if not user_doc.exists:
            logger.warning(f"User profile not found for user: {current_user_id}")
            return FeedResponse(updates=[], next_timestamp=None)

        # Extract group IDs from the user's profile
        user_data = user_doc.to_dict() or {}
        group_ids = user_data.get(ProfileFields.GROUP_IDS, [])

        # Return empty response if user is not a member of any groups
        if not group_ids:
            logger.info(f"User {current_user_id} is not a member of any groups")
            return FeedResponse(updates=[], next_timestamp=None)

        logger.info(f"User {current_user_id} is a member of {len(group_ids)} groups")

        # Build the query for updates from groups the user is in
        query = db.collection(Collections.UPDATES) \
            .where(UpdateFields.GROUP_IDS, "array-contains-any", group_ids) \
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

        logger.info(f"Retrieved {len(updates)} updates for user: {current_user_id}")
        return FeedResponse(
            updates=updates,
            next_timestamp=next_timestamp
        )
    except Exception as e:
        logger.error(f"Error retrieving feed for user {current_user_id}: {str(e)}", exc_info=True)
        # Use abort instead of returning empty response
        abort(500, "Internal server error while retrieving user feed")
