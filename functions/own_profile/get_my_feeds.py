from firebase_admin import firestore
from models.constants import Collections, ProfileFields, UpdateFields
from models.data_models import FeedResponse, Update


def get_my_feeds(request) -> FeedResponse:
    """
    Aggregates feed of all updates from all groups the current user is in, paginated.
    
    Query Parameters (validated by Pydantic in main.py):
    - limit: Maximum number of updates to return (default: 20, min: 1, max: 100)
    - after_timestamp: Timestamp for pagination in ISO format (e.g. "2025-01-01T12:00:00Z")
    
    Returns:
    - A list of updates from all groups the user is in and a next_timestamp for pagination
    """
    db = firestore.client()

    validated_params = getattr(request, 'validated_params', None)

    limit = validated_params.limit if validated_params else 20
    after_timestamp = validated_params.after_timestamp if validated_params else None

    user_doc = db.collection(Collections.PROFILES).document(request.user_id).get()

    if not user_doc.exists:
        return FeedResponse(updates=[])

    user_data = user_doc.to_dict() or {}
    group_ids = user_data.get(ProfileFields.GROUP_IDS, [])

    if not group_ids:
        return FeedResponse(updates=[])

    query = db.collection(Collections.UPDATES) \
        .where(UpdateFields.GROUP_IDS, "array-contains-any", group_ids) \
        .order_by(UpdateFields.CREATED_AT, direction=firestore.Query.DESCENDING) \
        .limit(limit)

    if after_timestamp:
        try:
            query = query.start_after({UpdateFields.CREATED_AT: after_timestamp})
        except Exception as e:
            print(f"Error applying pagination: {str(e)}")

    docs = query.stream()

    updates = []
    last_timestamp = None

    for doc in docs:
        doc_data = doc.to_dict()
        created_at = doc_data.get(UpdateFields.CREATED_AT, "")

        if created_at:
            last_timestamp = created_at

        updates.append(Update(
            updateId=doc.id,
            created_by=doc_data.get(UpdateFields.CREATED_BY, ""),
            content=doc_data.get(UpdateFields.CONTENT, ""),
            group_ids=doc_data.get(UpdateFields.GROUP_IDS, []),
            sentiment=doc_data.get(UpdateFields.SENTIMENT, 0),
            created_at=created_at
        ))

    next_timestamp = None
    if last_timestamp and len(updates) == limit:
        next_timestamp = last_timestamp

    return FeedResponse(
        updates=updates,
        next_timestamp=next_timestamp
    )
