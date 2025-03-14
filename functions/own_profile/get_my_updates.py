from firebase_admin import firestore

from functions.data_models import UpdatesResponse, Update


def get_my_updates(request) -> UpdatesResponse:
    """
    Retrieves the current user's updates in a paginated format.
    
    This function fetches updates created by the authenticated user from the Firestore
    database. The updates are returned in descending order by creation time (newest first)
    and support pagination for efficient data loading.
    
    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
                - validated_params: Pagination parameters (attached by route handler)
    
    Returns:
        An UpdatesResponse containing:
        - A list of updates belonging to the current user
        - A next_timestamp for pagination (if more results are available)
    
    Query Parameters (validated by Pydantic in main.py):
        - limit: Maximum number of updates to return (default: 20, min: 1, max: 100)
        - after_timestamp: Timestamp for pagination in ISO format (e.g. "2025-01-01T12:00:00Z")
    """
    db = firestore.client()

    # Get pagination parameters from the validated request
    validated_params = getattr(request, 'validated_params', None)
    limit = validated_params.limit if validated_params else 20
    after_timestamp = validated_params.after_timestamp if validated_params else None

    # Build the query for the user's updates
    query = db.collection("updates") \
        .where("created_by", "==", request.user_id) \
        .order_by("created_at", "desc") \
        .limit(limit)

    # Apply pagination if an after_timestamp is provided
    if after_timestamp:
        query = query.start_after({"created_at": after_timestamp})

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
            created_by=doc_data.get("created_by", request.user_id),
            content=doc_data.get("content", ""),
            group_ids=doc_data.get("group_ids", []),
            sentiment=doc_data.get("sentiment", 0),
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
