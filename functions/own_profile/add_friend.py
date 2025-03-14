from firebase_admin import firestore
from flask import abort
from google.cloud.firestore import SERVER_TIMESTAMP
from models.constants import Collections, FriendFields, Status
from models.data_models import AddFriendResponse
from utils.logging_utils import get_logger


def add_friend(request) -> AddFriendResponse:
    """
    Creates a mutual friendship relationship between the current user and another user.
    
    This function establishes a bidirectional friendship connection between the authenticated
    user and the specified friend. It creates entries in both users' friends subcollections
    with "accepted" status. The function performs validation to ensure the friend exists
    and that users cannot add themselves as friends.
    
    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
                - validated_params: The validated request parameters containing:
                    - friendId: The ID of the user to add as a friend
    
    Query Parameters:
        - friendId: The ID of the user to add as a friend
    
    Returns:
        An AddFriendResponse containing:
        - status: "ok" for success, "error" for failure
        - message: A description of the result or error
    
    Raises:
        404: Friend profile not found
        400: Invalid request (e.g., trying to add yourself as a friend)
        409: Conflict (e.g., friend relationship already exists)
        500: Server error during operation
    """
    logger = get_logger(__name__)
    logger.info(f"Adding friend relationship between {request.user_id} and {request.validated_params['friendId']}")

    # Get the friend ID from the validated request parameters
    friend_id = request.validated_params['friendId']
    current_user_id = request.user_id

    # Prevent users from adding themselves as friends
    if current_user_id == friend_id:
        logger.warning(f"User {current_user_id} attempted to add themselves as a friend")
        abort(400, description="Cannot add yourself as a friend")

    db = firestore.client()

    # Check if the friend's profile exists
    friend_profile_ref = db.collection(Collections.PROFILES).document(friend_id)
    friend_profile_doc = friend_profile_ref.get()

    if not friend_profile_doc.exists:
        logger.warning(f"Friend profile {friend_id} not found")
        abort(404, description="Friend profile not found")

    # Check if they are already friends
    current_user_profile_ref = db.collection(Collections.PROFILES).document(current_user_id)
    friend_doc_ref = current_user_profile_ref.collection(Collections.FRIENDS).document(friend_id)
    friend_doc = friend_doc_ref.get()

    if friend_doc.exists and friend_doc.to_dict().get(FriendFields.STATUS) == Status.ACCEPTED:
        logger.warning(f"Users {current_user_id} and {friend_id} are already friends")
        abort(409, description="Already friends with this user")

    try:
        # Add to current user's friends collection
        friend_doc_ref.set({
            FriendFields.STATUS: Status.ACCEPTED,
            FriendFields.CREATED_AT: SERVER_TIMESTAMP
        })
        logger.info(f"Added {friend_id} to {current_user_id}'s friends collection with status ACCEPTED")

        # Add to friend's friends collection
        friend_profile_ref.collection(Collections.FRIENDS).document(current_user_id).set({
            FriendFields.STATUS: Status.ACCEPTED,
            FriendFields.CREATED_AT: SERVER_TIMESTAMP
        })
        logger.info(f"Added {current_user_id} to {friend_id}'s friends collection with status ACCEPTED")

        logger.info(f"Friend relationship between {current_user_id} and {friend_id} successfully established")
        return AddFriendResponse(
            status=Status.OK,
            message="Friend added successfully"
        )
    except Exception as e:
        logger.error(f"Error adding friend relationship: {str(e)}", exc_info=True)
        abort(500, description="Internal server error")
