from firebase_admin import firestore
from flask import abort
from google.cloud.firestore import SERVER_TIMESTAMP
from models.constants import Collections, FriendshipFields, Status, ProfileFields
from models.data_models import Friend
from utils.logging_utils import get_logger


def add_friend(request) -> Friend:
    """
    Creates a mutual friendship relationship between the current user and another user.
    
    This function establishes a bidirectional friendship connection between the authenticated
    user and the specified friend. It creates a friendship document in the friendships collection
    with "pending" status. The function performs validation to ensure the friend exists
    and that users cannot add themselves as friends.
    
    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
                - validated_params: The validated request parameters containing:
                    - friendId: The ID of the user to add as a friend
    
    Query Parameters:
        - friendId: The ID of the user to add as a friend
    
    Returns:
        A Friend object representing the newly created friend relationship
    
    Raises:
        404: Friend profile not found
        400: Invalid request (e.g., trying to add yourself as a friend)
        409: Conflict (e.g., friend relationship already exists)
        500: Server error during operation
    """
    logger = get_logger(__name__)
    logger.info(f"Adding friend relationship between {request.user_id} and {request.validated_params.friend_id}")

    # Get the friend ID from the validated request parameters
    friend_id = request.validated_params.friend_id
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

    # Get current user's profile for name and avatar
    current_user_profile_ref = db.collection(Collections.PROFILES).document(current_user_id)
    current_user_profile_doc = current_user_profile_ref.get()

    if not current_user_profile_doc.exists:
        logger.warning(f"Current user profile {current_user_id} not found")
        abort(404, description="Current user profile not found")

    current_user_profile = current_user_profile_doc.to_dict()
    friend_profile = friend_profile_doc.to_dict()

    # Check if they are already friends by querying the friendships collection
    # Create a consistent friendship ID by sorting the user IDs
    user_ids = sorted([current_user_id, friend_id])
    friendship_id = f"{user_ids[0]}_{user_ids[1]}"

    friendship_ref = db.collection(Collections.FRIENDSHIPS).document(friendship_id)
    friendship_doc = friendship_ref.get()

    # Check if friendship already exists
    if friendship_doc.exists:
        friendship_data = friendship_doc.to_dict()
        status = friendship_data.get(FriendshipFields.STATUS)

        if status == Status.ACCEPTED:
            logger.warning(f"Users {current_user_id} and {friend_id} are already friends")
            abort(409, description="Already friends with this user")
        elif status == Status.PENDING:
            # If there's already a pending request, check who sent it
            sender_id = friendship_data.get(FriendshipFields.SENDER_ID)
            if sender_id == current_user_id:
                logger.warning(f"User {current_user_id} already sent a friend request to {friend_id}")
                abort(409, description="Friend request already sent to this user")
            else:
                logger.warning(f"User {current_user_id} has a pending friend request from {friend_id}")
                abort(409, description="You have a pending friend request from this user")

    try:
        # Create or update the friendship document
        friendship_data = {
            FriendshipFields.SENDER_ID: current_user_id,
            FriendshipFields.SENDER_NAME: current_user_profile.get(ProfileFields.NAME, ''),
            FriendshipFields.SENDER_AVATAR: current_user_profile.get(ProfileFields.AVATAR, ''),
            FriendshipFields.RECEIVER_ID: friend_id,
            FriendshipFields.RECEIVER_NAME: friend_profile.get(ProfileFields.NAME, ''),
            FriendshipFields.RECEIVER_AVATAR: friend_profile.get(ProfileFields.AVATAR, ''),
            FriendshipFields.STATUS: Status.PENDING,
            FriendshipFields.CREATED_AT: SERVER_TIMESTAMP,
            FriendshipFields.UPDATED_AT: SERVER_TIMESTAMP,
            FriendshipFields.MEMBERS: [current_user_id, friend_id]
        }

        # Set the friendship document
        friendship_ref.set(friendship_data)
        logger.info(
            f"Created friendship request document with ID {friendship_id} from {current_user_id} to {friend_id}")

        logger.info(f"Friend request from {current_user_id} to {friend_id} successfully sent")

        # Return a Friend object representing the friend that was added
        return Friend(
            id=friend_id,
            name=friend_profile.get(ProfileFields.NAME, ''),
            avatar=friend_profile.get(ProfileFields.AVATAR, ''),
            status=Status.PENDING
        )
    except Exception as e:
        logger.error(f"Error adding friend relationship: {str(e)}", exc_info=True)
        abort(500, description="Internal server error")
