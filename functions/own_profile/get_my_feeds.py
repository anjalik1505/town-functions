from firebase_admin import firestore

from functions.data_models import FeedResponse, Update


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
    db = firestore.client()

    # Get pagination parameters from the validated request
    validated_params = getattr(request, 'validated_params', None)
    limit = validated_params.limit if validated_params else 20
    after_timestamp = validated_params.after_timestamp if validated_params else None

    # Retrieve the user's profile to get their group memberships
    user_doc = db.collection("profiles").document(request.user_id).get()

    # Return empty response if user profile doesn't exist
    if not user_doc.exists:
        return FeedResponse(updates=[])

    # Extract group IDs from the user's profile
    user_data = user_doc.to_dict() or {}
    group_ids = user_data.get("group_ids", [])

    # Return empty response if user is not a member of any groups
    if not group_ids:
        return FeedResponse(updates=[])

    # Build the query for updates from the user's groups
    query = db.collection("updates") \
        .where("group_ids", "array-contains-any", group_ids) \
        .order_by("created_at", "desc") \
        .limit(limit)

    # Apply pagination if an after_timestamp is provided
    if after_timestamp:
        try:
            query = query.start_after({"created_at": after_timestamp})
        except Exception as e:
            print(f"Error applying pagination: {str(e)}")

    # Execute the query
    docs = query.stream()

    updates = []
    last_timestamp = None

    # Process the query results
    for doc in docs:
        doc_data = doc.to_dict()
        created_at = doc_data.get("created_at", "")

        # Track the last timestamp for pagination
        if created_at:
            last_timestamp = created_at

        # Convert Firestore document to Update model
        updates.append(Update(
            updateId=doc.id,
            created_by=doc_data.get("created_by", ""),
            content=doc_data.get("content", ""),
            group_ids=doc_data.get("group_ids", []),
            sentiment=doc_data.get("sentiment", 0),
            created_at=created_at
        ))

    # Set up pagination for the next request
    next_timestamp = None
    if last_timestamp and len(updates) == limit:
        next_timestamp = last_timestamp

    return FeedResponse(
        updates=updates,
        next_timestamp=next_timestamp
    )
