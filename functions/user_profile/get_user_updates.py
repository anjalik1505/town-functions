from firebase_admin import firestore
from flask import abort
from functions.data_models import UpdatesResponse, Update
from functions.pydantic_models import GetPaginatedRequest

from functions.models.constants import Collections, ProfileFields, UpdateFields


def get_user_updates(request, user_id: str) -> UpdatesResponse:
    """
    Fetches updates from a user that the current user is allowed to see.
    
    This function retrieves updates created by the specified user_id that are visible
    to the current user. Updates are only visible if:
    1. The users are friends
    2. They share at least one group
    3. The update is associated with one of those shared groups
    
    If there are no shared groups, an empty update list is returned.
    
    Args:
        request: The incoming HTTP request with:
                - user_id: The authenticated user's ID (attached by authentication middleware)
                - validated_params: Pagination parameters containing:
                    - limit: Maximum number of updates to return
                    - after_timestamp: Timestamp for pagination
        user_id: The ID of the user whose updates are being requested.
    
    Query Parameters:
        - limit: Maximum number of updates to return (default: 20, min: 1, max: 100)
        - after_timestamp: Timestamp for pagination in ISO format (e.g. "2025-01-01T12:00:00Z")
    
    Returns:
        An UpdatesResponse containing:
        - A list of updates visible to the current user
        - A next_timestamp for pagination (if more results are available)
    
    Raises:
        400: If the user tries to view their own updates through this endpoint.
        404: If the target user profile does not exist.
        403: If the requesting user and target user are not friends.
    """
    db = firestore.client()
    current_user_id = request.user_id

    # Redirect users to the appropriate endpoint for their own updates
    if current_user_id == user_id:
        abort(400, "Use /me/updates endpoint to view your own updates")

    # Get the target user's profile
    target_user_profile_ref = db.collection(Collections.PROFILES).document(user_id)
    target_user_profile_doc = target_user_profile_ref.get()

    if not target_user_profile_doc.exists:
        abort(404, "Profile not found")

    target_user_profile_data = target_user_profile_doc.to_dict() or {}

    # Check if users are friends
    current_user_profile_ref = db.collection(Collections.PROFILES).document(current_user_id)
    friend_ref = current_user_profile_ref.collection(Collections.FRIENDS).document(user_id)
    is_friend = friend_ref.get().exists

    # If they are not friends, return an error
    if not is_friend:
        abort(403, "You must be friends with this user to view their updates")

    # Get current user's groups
    current_user_profile_doc = current_user_profile_ref.get()
    current_user_profile = current_user_profile_doc.to_dict() or {}
    current_user_groups = current_user_profile.get(ProfileFields.GROUP_IDS, [])

    # Get target user's groups
    target_user_groups = target_user_profile_data.get(ProfileFields.GROUP_IDS, [])

    # Find groups that both users are members of
    shared_groups = list(set(current_user_groups) & set(target_user_groups))

    # If there are no shared groups, return an empty update list
    if not shared_groups:
        return UpdatesResponse(
            updates=[],
            next_timestamp=None
        )

    # Get pagination parameters from the validated request
    validated_params = getattr(request, 'validated_params', None)
    limit = validated_params.limit if validated_params else 20
    after_timestamp = validated_params.after_timestamp if validated_params else None

    # Build the query for updates
    query = db.collection(Collections.UPDATES) \
        .where(UpdateFields.CREATED_BY, "==", user_id) \
        .where(UpdateFields.GROUP_IDS, "array-contains-any", shared_groups) \
        .order_by(UpdateFields.CREATED_AT, direction=firestore.Query.DESCENDING) \
        .limit(limit)

    # Apply pagination if an after_timestamp is provided
    if after_timestamp:
        query = query.start_after({UpdateFields.CREATED_AT: after_timestamp})

    docs = query.stream()

    updates = []
    last_timestamp = None

    # Process the query results
    for doc in docs:
        doc_data = doc.to_dict()
        created_at = doc_data.get(UpdateFields.CREATED_AT)

        if created_at:
            last_timestamp = created_at

        updates.append(Update(
            updateId=doc.id,
            created_by=doc_data.get(UpdateFields.CREATED_BY, user_id),
            content=doc_data.get(UpdateFields.CONTENT, ""),
            group_ids=doc_data.get(UpdateFields.GROUP_IDS, []),
            sentiment=doc_data.get(UpdateFields.SENTIMENT, 0),
            created_at=created_at
        ))

    # Set up pagination for the next request
    next_timestamp = None
    if last_timestamp and len(updates) == limit:
        next_timestamp = last_timestamp

    return UpdatesResponse(
        updates=updates,
        next_timestamp=next_timestamp
    )
