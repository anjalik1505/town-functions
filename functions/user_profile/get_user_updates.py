from datetime import datetime

from firebase_admin import firestore
from flask import abort
from models.constants import (
    Collections,
    FriendshipFields,
    ProfileFields,
    QueryOperators,
    Status,
    UpdateFields,
)
from models.data_models import Update, UpdatesResponse
from utils.logging_utils import get_logger


def get_user_updates(request, target_user_id) -> UpdatesResponse:
    """
    Retrieves paginated updates for a specific user.

    This function fetches:
    1. Updates created by the target user that has the current user as a friend
    2. Updates from groups shared between the current user and target user

    The updates are ordered by creation time (newest first) and supports pagination
    for efficient data loading. The function enforces friendship checks to ensure
    only friends can view each other's updates.

    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
                - validated_params: Pagination parameters containing:
                    - limit: Maximum number of updates to return
                    - after_timestamp: Timestamp for pagination
        target_user_id: The ID of the user whose updates are being requested

    Query Parameters:
        - limit: Maximum number of updates to return (default: 20, min: 1, max: 100)
        - after_timestamp: Timestamp for pagination in ISO format (e.g. "2025-01-01T12:00:00Z")

    Returns:
        An UpdatesResponse containing:
        - A list of updates created by the specified user and from shared groups
        - A next_timestamp for pagination (if more results are available)

    Raises:
        400: Use /me/updates endpoint to view your own updates
        404: Profile not found
        403: You must be friends with this user to view their updates
    """
    logger = get_logger(__name__)
    logger.info(
        f"Retrieving updates for user {target_user_id} requested by {request.user_id}"
    )

    db = firestore.client()
    current_user_id = request.user_id

    # Redirect users to the appropriate endpoint for their own updates
    if current_user_id == target_user_id:
        logger.warning(
            f"User {current_user_id} attempted to view their own updates through /user endpoint"
        )
        abort(400, "Use /me/updates endpoint to view your own updates")

    # Get pagination parameters from the validated request
    validated_params = request.validated_params
    limit = validated_params.limit if validated_params else 20
    after_timestamp = validated_params.after_timestamp if validated_params else None

    logger.info(
        f"Pagination parameters - limit: {limit}, after_timestamp: {after_timestamp}"
    )

    # Get the target user's profile
    target_user_profile_ref = db.collection(Collections.PROFILES).document(
        target_user_id
    )
    target_user_profile_doc = target_user_profile_ref.get()

    # Check if the target profile exists
    if not target_user_profile_doc.exists:
        logger.warning(f"Profile not found for user {target_user_id}")
        abort(404, "Profile not found")

    # Get the current user's profile
    current_user_profile_ref = db.collection(Collections.PROFILES).document(
        current_user_id
    )
    current_user_profile_doc = current_user_profile_ref.get()

    if not current_user_profile_doc.exists:
        logger.warning(f"Profile not found for current user {current_user_id}")
        abort(404, "Profile not found")

    # Get the group IDs for both users to find shared groups
    target_user_data = target_user_profile_doc.to_dict() or {}
    current_user_data = current_user_profile_doc.to_dict() or {}

    target_group_ids = target_user_data.get(ProfileFields.GROUP_IDS, [])
    current_group_ids = current_user_data.get(ProfileFields.GROUP_IDS, [])

    # Find shared groups
    shared_group_ids = list(set(target_group_ids) & set(current_group_ids))
    logger.info(f"Found {len(shared_group_ids)} shared groups between users")

    # Check if users are friends using the unified friendships collection
    # Create a consistent ordering of user IDs for the query
    user_ids = sorted([current_user_id, target_user_id])
    friendship_id = f"{user_ids[0]}_{user_ids[1]}"

    friendship_ref = db.collection(Collections.FRIENDSHIPS).document(friendship_id)
    friendship_doc = friendship_ref.get()

    # If they are not friends, return an error
    if (
        not friendship_doc.exists
        or friendship_doc.to_dict().get(FriendshipFields.STATUS) != Status.ACCEPTED
    ):
        logger.warning(
            f"User {current_user_id} attempted to view updates of non-friend {target_user_id}"
        )
        abort(403, "You must be friends with this user to view their updates")

    logger.info(f"Friendship verified between {current_user_id} and {target_user_id}")

    # Get updates from the target user with pagination to ensure we get enough items
    user_updates = []
    last_doc = None
    batch_size = limit * 2  # Fetch more items than needed to account for filtering

    # Continue fetching until we have enough items or there are no more to fetch
    while len(user_updates) < limit:
        # Build the query
        user_query = (
            db.collection(Collections.UPDATES)
            .where(UpdateFields.CREATED_BY, QueryOperators.EQUALS, target_user_id)
            .order_by(UpdateFields.CREATED_AT, direction=firestore.Query.DESCENDING)
        )

        # Apply pagination from the last document or after_timestamp
        if last_doc:
            user_query = user_query.start_after(last_doc)
        elif after_timestamp:
            user_query = user_query.start_after(
                {UpdateFields.CREATED_AT: after_timestamp}
            )

        user_query = user_query.limit(batch_size)
        user_docs = list(user_query.stream())

        # If no more documents, break the loop
        if not user_docs:
            break

        # Keep track of the last document for pagination
        last_doc = user_docs[-1]

        # Process the documents
        for doc in user_docs:
            doc_data = doc.to_dict()
            created_at = doc_data.get(UpdateFields.CREATED_AT, "")
            update_group_ids = doc_data.get(UpdateFields.GROUP_IDS, [])

            # Convert Firestore datetime to ISO format string for the Update model
            created_at_iso = (
                created_at.isoformat()
                if isinstance(created_at, datetime)
                else created_at
            )

            # Check if the update is in a shared group or if the current user is a friend
            is_in_shared_group = False
            for group_id in update_group_ids:
                if group_id in shared_group_ids:
                    is_in_shared_group = True
                    break

            friend_ids = doc_data.get(UpdateFields.FRIEND_IDS, [])
            is_friend = current_user_id in friend_ids

            # Only include the update if it's in a shared group or the current user is a friend
            if is_in_shared_group or is_friend:
                # Convert Firestore document to Update model
                user_updates.append(
                    Update(
                        update_id=doc.id,
                        created_by=doc_data.get(UpdateFields.CREATED_BY, ""),
                        content=doc_data.get(UpdateFields.CONTENT, ""),
                        group_ids=update_group_ids,
                        friend_ids=friend_ids,
                        sentiment=doc_data.get(UpdateFields.SENTIMENT, ""),
                        created_at=created_at_iso,
                    )
                )

                # If we have enough items, break the loop
                if len(user_updates) >= limit:
                    break

    # Limit to exactly the requested number
    user_updates = user_updates[:limit]

    # Set up pagination for the next request
    next_timestamp = None
    if len(user_updates) == limit:
        last_timestamp = user_updates[-1].created_at
        # Convert the timestamp to ISO format for pagination if it's a datetime object
        if isinstance(last_timestamp, datetime):
            next_timestamp = last_timestamp.isoformat()
        else:
            next_timestamp = last_timestamp
        logger.info(f"More results available, next_timestamp: {next_timestamp}")

    logger.info(f"Retrieved {len(user_updates)} updates for user {target_user_id}")
    return UpdatesResponse(updates=user_updates, next_timestamp=next_timestamp)
