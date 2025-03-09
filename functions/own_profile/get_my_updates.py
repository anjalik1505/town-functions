from firebase_admin import firestore

from functions.data_models import UpdatesResponse, Update


def get_my_updates(request) -> UpdatesResponse:
    """
    Retrieves the current user's updates in a paginated format.
    
    Query Parameters (validated by Pydantic in main.py):
    - limit: Maximum number of updates to return (default: 20, min: 1, max: 100)
    - after_timestamp: Timestamp for pagination in ISO format (e.g. "2025-01-01T12:00:00Z")
    
    Returns:
    - A list of the user's updates and a next_timestamp for pagination
    """
    db = firestore.client()

    validated_params = getattr(request, 'validated_params', None)

    limit = validated_params.limit if validated_params else 20
    after_timestamp = validated_params.after_timestamp if validated_params else None

    query = db.collection("updates") \
        .where("created_by", "==", request.user_id) \
        .order_by("created_at", "desc") \
        .limit(limit)

    if after_timestamp:
        try:
            query = query.start_after({"created_at": after_timestamp})
        except Exception as e:
            print(f"Error applying pagination: {str(e)}")

    docs = query.stream()

    updates = []
    last_timestamp = None

    for doc in docs:
        doc_data = doc.to_dict()
        created_at = doc_data.get("created_at", "")

        if created_at:
            last_timestamp = created_at

        updates.append(Update(
            updateId=doc.id,
            created_by=doc_data.get("created_by", request.user_id),
            content=doc_data.get("content", ""),
            group_ids=doc_data.get("group_ids", []),
            sentiment=doc_data.get("sentiment", 0),
            created_at=created_at
        ))

    next_timestamp = None
    if last_timestamp and len(updates) == limit:
        next_timestamp = last_timestamp

    return UpdatesResponse(
        updates=updates,
        next_timestamp=next_timestamp
    )
