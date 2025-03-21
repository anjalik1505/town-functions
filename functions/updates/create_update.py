import uuid
from datetime import datetime, timezone

from firebase_admin import firestore
from models.constants import Collections, UpdateFields
from models.data_models import Update
from utils.logging_utils import get_logger


def create_update(request) -> Update:
    """
    Creates a new update for the current user.

    This function creates a new update in the Firestore database with the content,
    sentiment, and visibility settings (friend_ids and group_ids) provided in the request.
    It also generates a combined visibility array for efficient querying.

    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
                - validated_params: The validated request data containing:
                    - content: The text content of the update
                    - sentiment: The sentiment value of the update
                    - group_ids: Optional list of group IDs to share the update with
                    - friend_ids: Optional list of friend IDs to share the update with

    Returns:
        An Update object representing the newly created update
    """
    logger = get_logger(__name__)
    logger.info(f"Creating update for user: {request.user_id}")

    # Get the authenticated user ID from the request
    current_user_id = request.user_id

    # Get validated data from the request
    validated_params = request.validated_params
    content = validated_params.content or ""
    sentiment = validated_params.sentiment or ""
    group_ids = validated_params.group_ids or []
    friend_ids = validated_params.friend_ids or []

    logger.info(
        f"Update details - content length: {len(content)}, "
        f"sentiment: {sentiment}, "
        f"shared with {len(friend_ids)} friends and {len(group_ids)} groups"
    )

    # Initialize Firestore client
    db = firestore.client()

    # Generate a unique ID for the update
    update_id = str(uuid.uuid4())

    # Get current timestamp in ISO format without the Z suffix
    created_at = datetime.now(timezone.utc)

    # Prepare the visible_to array for efficient querying
    # Format: ["friend:{friend_id}", "group:{group_id}"]
    visible_to = []

    # Add friend visibility identifiers
    for friend_id in friend_ids:
        visible_to.append(f"friend:{friend_id}")

    # Add group visibility identifiers
    for group_id in group_ids:
        visible_to.append(f"group:{group_id}")

    # Create the update document
    update_data = {
        UpdateFields.CREATED_BY: current_user_id,
        UpdateFields.CONTENT: content,
        UpdateFields.SENTIMENT: sentiment,
        UpdateFields.CREATED_AT: created_at,
        UpdateFields.GROUP_IDS: group_ids,
        UpdateFields.FRIEND_IDS: friend_ids,
        UpdateFields.VISIBLE_TO: visible_to,
    }

    # Save the update to Firestore
    db.collection(Collections.UPDATES).document(update_id).set(update_data)
    logger.info(f"Successfully created update with ID: {update_id}")

    # Return the created update (without the internal visible_to field)
    return Update(
        update_id=update_id,
        created_by=current_user_id,
        content=content,
        sentiment=sentiment,
        created_at=created_at.isoformat(),
        group_ids=group_ids,
        friend_ids=friend_ids,
    )
