from firebase_admin import firestore
from flask import abort
from models.constants import Collections, ProfileFields, FriendFields, Status
from models.data_models import FriendsResponse, Friend
from utils.logging_utils import get_logger


def get_my_friends(request) -> FriendsResponse:
    """
    Retrieves the current user's friends with "accepted" status.
    
    This function fetches all friendship relationships for the authenticated user
    that have an "accepted" status. For each friend, it retrieves their basic profile
    information (id, name, avatar) from the profiles collection.
    
    Args:
        request: The Flask request object containing:
                - user_id: The authenticated user's ID (attached by authentication middleware)
    
    Returns:
        A FriendsResponse containing:
        - A list of Friend objects with basic profile information for each friend
    """
    logger = get_logger(__name__)
    logger.info(f"Retrieving friends for user: {request.user_id}")

    # Get the authenticated user ID from the request
    current_user_id = request.user_id

    # Initialize Firestore client
    db = firestore.client()

    try:
        # Get the user's profile reference
        user_profile_ref = db.collection(Collections.PROFILES).document(current_user_id)

        # Query for accepted friends
        friends_ref = user_profile_ref.collection(Collections.FRIENDS) \
            .where(FriendFields.STATUS, "==", Status.ACCEPTED) \
            .stream()

        logger.info(f"Querying accepted friends for user: {current_user_id}")

        friends = []

        for doc in friends_ref:
            friend_user_id = doc.id
            logger.info(f"Processing friend: {friend_user_id}")

            # Get the friend's profile
            profile_ref = db.collection(Collections.PROFILES).document(friend_user_id)
            profile_doc = profile_ref.get()

            if profile_doc.exists:
                profile_data = profile_doc.to_dict() or {}

                friends.append(Friend(
                    id=friend_user_id,
                    name=profile_data.get(ProfileFields.NAME, ""),
                    avatar=profile_data.get(ProfileFields.AVATAR, "")
                ))
                logger.info(f"Added friend {friend_user_id} to results")
            else:
                logger.warning(f"Friend {friend_user_id} profile not found, skipping")

        logger.info(f"Retrieved {len(friends)} friends for user: {current_user_id}")

        # Return the list of friends
        return FriendsResponse(
            friends=friends
        )
    except Exception as e:
        logger.error(f"Error retrieving friends for user {current_user_id}: {str(e)}", exc_info=True)
        # Use abort instead of returning empty response
        abort(500, "Internal server error while retrieving user friends")
