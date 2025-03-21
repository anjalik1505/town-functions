from datetime import datetime

from firebase_admin import firestore
from flask import abort
from models.constants import (
    Collections,
    FriendshipFields,
    ProfileFields,
    Status,
    UserSummaryFields,
)
from models.data_models import FriendProfileResponse
from utils.logging_utils import get_logger


def get_user_profile(request, target_user_id) -> FriendProfileResponse:
    """
    Retrieves a user's profile with summary and suggestions.

    This function fetches the profile of the specified user, including their basic profile
    information and aggregated summary data. Summary data is collected from shared groups
    and direct chats between the current user and the requested user. The function enforces
    friendship checks to ensure only friends can view each other's profiles.

    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
        target_user_id: The ID of the user whose profile is being requested

    Returns:
        A FriendProfileResponse containing:
        - Basic profile information (id, name, avatar)
        - Location and birthday if available
        - Summary and suggestions if available
        - Updated timestamp

    Raises:
        400: Use /me/profile endpoint to view your own profile
        404: Profile not found
        403: You must be friends with this user to view their profile
    """
    logger = get_logger(__name__)
    logger.info(
        f"Retrieving profile for user {target_user_id} requested by {request.user_id}"
    )

    db = firestore.client()
    current_user_id = request.user_id

    # Redirect users to the appropriate endpoint for their own profile
    if current_user_id == target_user_id:
        logger.warning(
            f"User {current_user_id} attempted to view their own profile through /user endpoint"
        )
        abort(400, "Use /me/profile endpoint to view your own profile")

    # Get the target user's profile
    target_user_profile_ref = db.collection(Collections.PROFILES).document(
        target_user_id
    )
    target_user_profile_doc = target_user_profile_ref.get()

    # Check if the target profile exists
    if not target_user_profile_doc.exists:
        logger.warning(f"Profile not found")
        abort(404, "Profile not found")

    target_user_profile_data = target_user_profile_doc.to_dict() or {}

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
            f"User {current_user_id} attempted to view profile of non-friend {target_user_id}"
        )
        abort(403, "You must be friends with this user to view their profile")

    logger.info(f"Friendship verified between {current_user_id} and {target_user_id}")

    # Sort user IDs to create a consistent relationship ID (same logic as in process_friend_summary)
    user_ids = sorted([current_user_id, target_user_id])
    relationship_id = f"{user_ids[0]}_{user_ids[1]}"

    # Get the user summary document for this friendship
    user_summary_ref = db.collection(Collections.USER_SUMMARIES).document(
        relationship_id
    )
    user_summary_doc = user_summary_ref.get()

    # Initialize summary and suggestions
    summary = ""
    suggestions = ""

    if user_summary_doc.exists:
        user_summary_data = user_summary_doc.to_dict()
        # Only return the summary if the current user is the target (the one who should see it)
        if user_summary_data.get(UserSummaryFields.TARGET_ID) == current_user_id:
            summary = user_summary_data.get(UserSummaryFields.SUMMARY, "")
            suggestions = user_summary_data.get(UserSummaryFields.SUGGESTIONS, "")
            logger.info(f"Retrieved user summary for relationship {relationship_id}")
        else:
            logger.info(f"User {current_user_id} is not the target for this summary")
    else:
        logger.info(f"No user summary found for relationship {relationship_id}")

    updated_at = target_user_profile_data.get(ProfileFields.UPDATED_AT, "")
    if isinstance(updated_at, datetime):
        updated_at = updated_at.isoformat()

    # Return a FriendProfileResponse with the user's profile information and summary/suggestions if available
    return FriendProfileResponse(
        user_id=target_user_id,
        username=target_user_profile_data.get(ProfileFields.USERNAME, ""),
        name=target_user_profile_data.get(ProfileFields.NAME, ""),
        avatar=target_user_profile_data.get(ProfileFields.AVATAR, ""),
        location=target_user_profile_data.get(ProfileFields.LOCATION, ""),
        birthday=target_user_profile_data.get(ProfileFields.BIRTHDAY, ""),
        summary=summary,
        suggestions=suggestions,
        updated_at=updated_at,
    )
