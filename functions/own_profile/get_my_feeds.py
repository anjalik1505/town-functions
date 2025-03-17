from firebase_admin import firestore
from models.constants import (
    MAX_BATCH_SIZE,
    Collections,
    FriendshipFields,
    ProfileFields,
    QueryOperators,
    Status,
    UpdateFields,
)
from models.data_models import FeedResponse, Update
from utils.logging_utils import get_logger


def get_my_feeds(request) -> FeedResponse:
    """
    Aggregates feed of all updates from the user's friends and all groups the current user is in, paginated.

    This function retrieves:
    1. Updates from all friends of the authenticated user
    2. Updates from all groups that the authenticated user is a member of

    The updates are returned in descending order by creation time (newest first) and
    support pagination for efficient data loading.

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
        - A list of updates from all friends and all groups the user is in
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

    logger.info(
        f"Pagination parameters - limit: {limit}, after_timestamp: {after_timestamp}"
    )

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

    # Prepare visibility identifiers
    # Direct visibility as a friend
    friend_visibility = f"friend:{current_user_id}"

    # Group visibility for all groups the user is in
    group_visibilities = [f"group:{group_id}" for group_id in group_ids]

    # Combine all visibility identifiers
    all_visibilities = [friend_visibility] + group_visibilities

    logger.info(
        f"User {current_user_id} has visibility to {len(all_visibilities)} audiences (1 friend + {len(group_ids)} groups)"
    )

    # Return empty response if user has no visibility (should not happen with friend visibility)
    if not all_visibilities:
        logger.info(f"User {current_user_id} has no visibility to any updates")
        return FeedResponse(updates=[], next_timestamp=None)

    # Initialize results tracking
    processed_update_ids = set()  # Track processed update IDs to avoid duplicates
    all_batch_updates = []  # Collect all updates from all batches

    # Firestore has a limit of 10 values for array-contains-any
    # Split visibility identifiers into batches of 10 if needed
    MAX_ARRAY_CONTAINS = 10
    visibility_batches = [
        all_visibilities[i : i + MAX_ARRAY_CONTAINS]
        for i in range(0, len(all_visibilities), MAX_ARRAY_CONTAINS)
    ]

    logger.info(
        f"Split {len(all_visibilities)} visibility identifiers into {len(visibility_batches)} batches for querying"
    )

    # Process all visibility batches to get updates
    for visibility_batch in visibility_batches:
        # Query for updates visible to any identifier in this batch
        visibility_query = (
            db.collection(Collections.UPDATES)
            .where(
                UpdateFields.VISIBLE_TO,
                QueryOperators.ARRAY_CONTAINS_ANY,
                visibility_batch,
            )
            .order_by(UpdateFields.CREATED_AT, direction=firestore.Query.DESCENDING)
        )

        # Apply pagination
        if after_timestamp:
            visibility_query = visibility_query.start_after(
                {UpdateFields.CREATED_AT: after_timestamp}
            )

        # Get updates - use the exact limit since we'll process all batches before sorting and limiting
        batch_docs = list(visibility_query.limit(limit).stream())
        logger.info(
            f"Retrieved {len(batch_docs)} updates from visibility batch of size {len(visibility_batch)}"
        )

        # Process each document
        for doc in batch_docs:
            # Skip if we've already processed this update
            if doc.id in processed_update_ids:
                continue

            processed_update_ids.add(doc.id)
            doc_data = doc.to_dict()
            created_at = doc_data.get(UpdateFields.CREATED_AT, "")
            created_by = doc_data.get(UpdateFields.CREATED_BY, "")

            # Convert Firestore document to Update model
            update = Update(
                update_id=doc.id,
                created_by=created_by,
                content=doc_data.get(UpdateFields.CONTENT, ""),
                group_ids=doc_data.get(UpdateFields.GROUP_IDS, []),
                friend_ids=doc_data.get(UpdateFields.FRIEND_IDS, []),
                sentiment=doc_data.get(UpdateFields.SENTIMENT, ""),
                created_at=created_at,
            )

            all_batch_updates.append(update)

    # If we have updates, sort them by created_at
    if all_batch_updates:
        # Sort all updates by created_at (newest first)
        all_batch_updates.sort(key=lambda x: x.created_at, reverse=True)

        # Take only up to the limit
        sorted_updates = all_batch_updates[:limit]

        # Set up pagination for the next request
        next_timestamp = None
        if len(all_batch_updates) > limit:
            next_timestamp = sorted_updates[-1].created_at
            logger.info(f"More results available, next_timestamp: {next_timestamp}")
    else:
        # No updates found
        sorted_updates = []
        next_timestamp = None

    logger.info(f"Retrieved {len(sorted_updates)} updates for user {current_user_id}")
    return FeedResponse(updates=sorted_updates, next_timestamp=next_timestamp)
