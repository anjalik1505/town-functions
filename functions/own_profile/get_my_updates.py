from firebase_admin import firestore
from models.constants import Collections, UpdateFields, QueryOperators
from models.data_models import UpdatesResponse, Update
from utils.logging_utils import get_logger


def get_my_updates(request) -> UpdatesResponse:
    """
    Retrieves the current user's updates in a paginated format.

    This function fetches updates created by the authenticated user from the Firestore
    database. The updates are returned in descending order by creation time (newest first)
    and support pagination for efficient data loading.

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
        An UpdatesResponse containing:
        - A list of updates belonging to the current user
        - A next_timestamp for pagination (if more results are available)
    """
    logger = get_logger(__name__)
    logger.info(f"Retrieving updates for user: {request.user_id}")

    # Get the authenticated user ID from the request
    current_user_id = request.user_id

    # Initialize Firestore client
    db = firestore.client()

    # Get pagination parameters from the validated request
    validated_params = request.validated_params
    limit = validated_params.limit if validated_params else 20
    after_timestamp = validated_params.after_timestamp if validated_params else None

    logger.info(
        f"Pagination parameters - limit: {limit}, after_timestamp: {after_timestamp}"
    )

    query = (
        db.collection(Collections.UPDATES)
        .where(UpdateFields.CREATED_BY, QueryOperators.EQUALS, current_user_id)
        .order_by(UpdateFields.CREATED_AT, direction=firestore.Query.DESCENDING)
    )

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
        updates.append(
            Update(
                update_id=doc.id,
                created_by=doc_data.get(UpdateFields.CREATED_BY, current_user_id),
                content=doc_data.get(UpdateFields.CONTENT, ""),
                group_ids=doc_data.get(UpdateFields.GROUP_IDS, []),
                sentiment=doc_data.get(UpdateFields.SENTIMENT, 0),
                created_at=created_at,
            )
        )

    # Set up pagination for the next request
    next_timestamp = None
    if last_timestamp and len(updates) == limit:
        next_timestamp = last_timestamp
        logger.info(f"More results available, next_timestamp: {next_timestamp}")

    logger.info(f"Retrieved {len(updates)} updates for user: {current_user_id}")
    return UpdatesResponse(updates=updates, next_timestamp=next_timestamp)
