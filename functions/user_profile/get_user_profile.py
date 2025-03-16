from firebase_admin import firestore
from flask import abort
from models.constants import Collections, FriendshipFields, ProfileFields, Status
from models.data_models import ProfileResponse
from utils.logging_utils import get_logger


def get_user_profile(request, target_user_id) -> ProfileResponse:
    """
    Retrieves a user's profile with summary and suggestions.

    This function fetches the profile of the specified user, including their basic profile
    information and aggregated summary data. Summary data is collected from shared groups
    and direct chats between the current user and the requested user. The function enforces
    friendship checks to ensure only friends can view each other's profiles.

    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
        user_id: The ID of the user whose profile is being requested

    Returns:
        A ProfileResponse containing:
        - Basic profile information (id, name, avatar)

    Raises:
        400: If the user tries to view their own profile through this endpoint.
        404: If the target user profile does not exist.
        403: If the requesting user and target user are not friends.
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
        logger.warning(f"Profile not found for user {target_user_id}")
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

    # Initialize empty lists to collect all summary data
    suggestions_parts = []
    summary_parts = []

    logger.info(f"Successfully retrieved profile for user {target_user_id}")

    # Combine all summary parts
    # NOTE: Summary and suggestions data removed as requested

    # Return a ProfileResponse with the user's profile information (without summary and suggestions)
    return ProfileResponse(
        user_id=target_user_id,
        username=target_user_profile_data.get(ProfileFields.USERNAME, ""),
        name=target_user_profile_data.get(ProfileFields.NAME, ""),
        avatar=target_user_profile_data.get(ProfileFields.AVATAR, ""),
        suggestions=suggestions_parts,
        summary=summary_parts,
    )
