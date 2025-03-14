from firebase_admin import firestore
from flask import Request, abort
from models.constants import Collections, GroupFields, QueryOperators, UpdateFields
from models.data_models import FeedResponse, Update
from utils.logging_utils import get_logger


def get_group_feed(request: Request, group_id: str) -> FeedResponse:
    """
    Retrieves all updates for a specific group, paginated.
    
    This function fetches updates that include the specified group ID in their group_ids array.
    The updates are returned in descending order by creation time (newest first) and
    support pagination for efficient data loading.
    
    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
                - validated_params: Pagination parameters containing:
                    - limit: Maximum number of updates to return
                    - after_timestamp: Timestamp for pagination
        group_id: The ID of the group to retrieve updates for
    
    Query Parameters:
        - limit: Maximum number of updates to return (default: 20, min: 1, max: 100)
        - after_timestamp: Timestamp for pagination in ISO format (e.g. "2025-01-01T12:00:00Z")
    
    Returns:
        A FeedResponse containing:
        - A list of updates for the specified group
        - A next_timestamp for pagination (if more results are available)
        
    Raises:
        404: Group not found
        403: User is not a member of the group
        500: Internal server error
    """
    logger = get_logger(__name__)
    logger.info(f"Retrieving feed for group: {group_id}")

    # Get the authenticated user ID from the request
    current_user_id = request.user_id

    # Initialize Firestore client
    db = firestore.client()

    # Get pagination parameters from the validated request
    validated_params = request.validated_params
    limit = validated_params.limit if validated_params else 20
    after_timestamp = validated_params.after_timestamp if validated_params else None

    logger.info(f"Pagination parameters - limit: {limit}, after_timestamp: {after_timestamp}")

    # First, check if the group exists and if the user is a member
    group_ref = db.collection(Collections.GROUPS).document(group_id)
    group_doc = group_ref.get()

    if not group_doc.exists:
        logger.warning(f"Group {group_id} not found")
        abort(404, description="Group not found")

    group_data = group_doc.to_dict()
    members = group_data.get(GroupFields.MEMBERS, [])

    # Check if the current user is a member of the group
    if current_user_id not in members:
        logger.warning(f"User {current_user_id} is not a member of group {group_id}")
        abort(403, description="You must be a member of the group to view its feed")

    # Build the query for updates from this group
    query = db.collection(Collections.UPDATES) \
        .where(UpdateFields.GROUP_IDS, QueryOperators.ARRAY_CONTAINS, group_id) \
        .order_by(UpdateFields.CREATED_AT, direction=firestore.Query.DESCENDING)

    # Apply pagination if an after_timestamp is provided
    if after_timestamp:
        query = query.start_after({UpdateFields.CREATED_AT: after_timestamp})
        logger.info(f"Applying pagination with timestamp: {after_timestamp}")

    # Apply limit last
    query = query.limit(limit)

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

    logger.info(f"Retrieved {len(updates)} updates for group: {group_id}")
    return FeedResponse(
        updates=updates,
        next_timestamp=next_timestamp
    )
