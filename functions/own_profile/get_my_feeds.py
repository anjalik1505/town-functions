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

    # Get friend IDs from friendships collection
    friend_ids = []

    # Query for friendships where current user is the sender
    sender_friendships = (
        db.collection(Collections.FRIENDSHIPS)
        .where(FriendshipFields.SENDER_ID, QueryOperators.EQUALS, current_user_id)
        .where(FriendshipFields.STATUS, QueryOperators.EQUALS, Status.ACCEPTED)
        .stream()
    )

    # Add receiver IDs to friend_ids
    for friendship in sender_friendships:
        friendship_data = friendship.to_dict()
        friend_ids.append(friendship_data.get(FriendshipFields.RECEIVER_ID))

    # Query for friendships where current user is the receiver
    receiver_friendships = (
        db.collection(Collections.FRIENDSHIPS)
        .where(FriendshipFields.RECEIVER_ID, QueryOperators.EQUALS, current_user_id)
        .where(FriendshipFields.STATUS, QueryOperators.EQUALS, Status.ACCEPTED)
        .stream()
    )

    # Add sender IDs to friend_ids
    for friendship in receiver_friendships:
        friendship_data = friendship.to_dict()
        friend_ids.append(friendship_data.get(FriendshipFields.SENDER_ID))

    logger.info(
        f"User {current_user_id} has {len(friend_ids)} friends and is a member of {len(group_ids)} groups"
    )

    # Return empty response if user has no friends and is not in any groups
    if not friend_ids and not group_ids:
        logger.info(
            f"User {current_user_id} has no friends and is not a member of any groups"
        )
        return FeedResponse(updates=[], next_timestamp=None)

    # Initialize combined updates list
    combined_updates = []
    batch_size = limit * 2  # Fetch more items than needed to account for filtering
    last_timestamp = after_timestamp

    # Fetch updates until we have enough or there are no more
    while len(combined_updates) < limit:
        batch_updates = []

        # Get updates from groups if any
        if group_ids:
            # Firestore has a limit of 10 values for array-contains-any
            # Split group_ids into batches of 10 if needed
            MAX_ARRAY_CONTAINS = 10
            group_id_batches = [
                group_ids[i : i + MAX_ARRAY_CONTAINS]
                for i in range(0, len(group_ids), MAX_ARRAY_CONTAINS)
            ]

            logger.info(
                f"Split {len(group_ids)} group IDs into {len(group_id_batches)} batches for querying"
            )

            # Process each batch of group IDs
            for group_id_batch in group_id_batches:
                group_query = (
                    db.collection(Collections.UPDATES)
                    .where(
                        UpdateFields.GROUP_IDS,
                        QueryOperators.ARRAY_CONTAINS_ANY,
                        group_id_batch,
                    )
                    .order_by(
                        UpdateFields.CREATED_AT, direction=firestore.Query.DESCENDING
                    )
                )

                # Apply pagination
                if last_timestamp:
                    group_query = group_query.start_after(
                        {UpdateFields.CREATED_AT: last_timestamp}
                    )

                group_docs = list(group_query.limit(batch_size).stream())
                logger.info(
                    f"Retrieved {len(group_docs)} updates from group batch of size {len(group_id_batch)}"
                )

                for doc in group_docs:
                    doc_data = doc.to_dict()
                    created_at = doc_data.get(UpdateFields.CREATED_AT, "")
                    created_by = doc_data.get(UpdateFields.CREATED_BY, "")

                    # Convert Firestore document to Update model
                    batch_updates.append(
                        Update(
                            update_id=doc.id,
                            created_by=created_by,
                            content=doc_data.get(UpdateFields.CONTENT, ""),
                            group_ids=doc_data.get(UpdateFields.GROUP_IDS, []),
                            friend_ids=friend_ids if created_by in friend_ids else None,
                            sentiment=doc_data.get(UpdateFields.SENTIMENT, ""),
                            created_at=created_at,
                        )
                    )

        # Get updates from friends if any
        if friend_ids:
            # Firestore has a limit of 10 values for 'in' operator
            # Split friend_ids into batches of 10 if needed
            friend_id_batches = [
                friend_ids[i : i + MAX_BATCH_SIZE]
                for i in range(0, len(friend_ids), MAX_BATCH_SIZE)
            ]

            logger.info(
                f"Split {len(friend_ids)} friend IDs into {len(friend_id_batches)} batches for querying"
            )

            # Process each batch of friend IDs
            for friend_id_batch in friend_id_batches:
                friend_query = (
                    db.collection(Collections.UPDATES)
                    .where(UpdateFields.CREATED_BY, QueryOperators.IN, friend_id_batch)
                    .order_by(
                        UpdateFields.CREATED_AT, direction=firestore.Query.DESCENDING
                    )
                )

                # Apply pagination
                if last_timestamp:
                    friend_query = friend_query.start_after(
                        {UpdateFields.CREATED_AT: last_timestamp}
                    )

                friend_docs = list(friend_query.limit(batch_size).stream())
                logger.info(
                    f"Retrieved {len(friend_docs)} updates from friend batch of size {len(friend_id_batch)}"
                )

                for doc in friend_docs:
                    doc_data = doc.to_dict()
                    created_at = doc_data.get(UpdateFields.CREATED_AT, "")
                    created_by = doc_data.get(UpdateFields.CREATED_BY, "")

                    # Convert Firestore document to Update model
                    batch_updates.append(
                        Update(
                            update_id=doc.id,
                            created_by=created_by,
                            content=doc_data.get(UpdateFields.CONTENT, ""),
                            group_ids=doc_data.get(UpdateFields.GROUP_IDS, []),
                            friend_ids=[created_by],
                            sentiment=doc_data.get(UpdateFields.SENTIMENT, ""),
                            created_at=created_at,
                        )
                    )

        # If no more updates, break the loop
        if not batch_updates:
            break

        # Sort batch updates by created_at
        batch_updates.sort(key=lambda x: x.created_at, reverse=True)

        # Add to combined updates, avoiding duplicates
        for update in batch_updates:
            if update.update_id not in [u.update_id for u in combined_updates]:
                combined_updates.append(update)

                # If we have enough updates, break
                if len(combined_updates) >= limit:
                    break

        # Update last_timestamp for next iteration if needed
        if batch_updates and len(combined_updates) < limit:
            last_timestamp = batch_updates[-1].created_at

    # Limit to the requested number of updates
    sorted_updates = combined_updates[:limit]

    # Set up pagination for the next request
    next_timestamp = None
    if len(sorted_updates) == limit:
        next_timestamp = sorted_updates[-1].created_at
        logger.info(f"More results available, next_timestamp: {next_timestamp}")

    logger.info(f"Retrieved {len(sorted_updates)} updates for user {current_user_id}")
    return FeedResponse(updates=sorted_updates, next_timestamp=next_timestamp)
